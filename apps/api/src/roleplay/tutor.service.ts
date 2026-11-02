import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Scenario } from '../database/schema';
import { LlmClient } from '../llm/llm.client';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', tr: 'Turkish', ar: 'Arabic',
};

/** How many earlier lines of the conversation go into each call (D10: bounded prompts). */
const HISTORY_WINDOW = 8;
const MAX_TOKENS = 450;
const MAX_ACTIONS = 4;

export interface TutorCorrection {
  original: string;
  corrected: string;
  ruleKey: string;
  ruleName: string;
  explanation: string;
}

/** Actions the tutor asks for (D24). The server validates and resolves them; words via the dictionary. */
export type TutorAction =
  | { type: 'word'; lemma: string; save: boolean }
  | { type: 'play'; text: string }
  | { type: 'grammar'; ruleKey: string; ruleName: string; explanation: string; examples: string[] }
  | { type: 'goal'; index: number }
  | { type: 'complete'; reason: string };

/** Personal memory put into the prompt: no extra LLM round. */
export interface TutorMemory {
  recentMistakes: string[];
  recentWords: string[];
  goalsAchieved: number[];
}

export interface TutorResult {
  reply: string;
  understood: boolean;
  corrections: TutorCorrection[];
  actions: TutorAction[];
  promptTokens: number | null;
  completionTokens: number | null;
}

const slug = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'grammar';

/**
 * Corrections are best effort: malformed items are dropped instead of failing the turn.
 * Only the reply is strict, because without it the conversation can't continue.
 */
const CorrectionItem = z
  .object({
    original: z.string().trim().min(1).max(200),
    corrected: z.string().trim().min(1).max(200),
    ruleKey: z.string().optional(),
    ruleName: z.string().trim().max(80).optional(),
    explanation: z.string().trim().min(1).max(500),
  })
  .transform((c) => ({
    original: c.original,
    corrected: c.corrected,
    ruleKey: slug(c.ruleKey || c.ruleName || 'grammar'),
    ruleName: c.ruleName || c.ruleKey || 'Grammar',
    explanation: c.explanation,
  }));

const str = (max: number) => z.string().trim().min(1).max(max);
const ActionItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('word'), lemma: str(80), save: z.preprocess((v) => v === true || v === 'true', z.boolean()) }),
  z.object({ type: z.literal('play'), text: str(160) }),
  z.object({
    type: z.literal('grammar'),
    ruleKey: z.string().optional(),
    ruleName: str(80),
    explanation: str(400),
    examples: z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 3) : []), z.array(z.string())),
  }),
  z.object({ type: z.literal('goal'), index: z.coerce.number().int().min(0).max(20) }),
  z.object({ type: z.literal('complete'), reason: str(300) }),
]);

const TutorSchema = z.object({
  reply: z.string().trim().min(1).max(600),
  understood: z.preprocess((v) => (typeof v === 'string' ? v.toLowerCase() !== 'false' : v ?? true), z.boolean()),
  corrections: z.preprocess((v) => {
    const items = Array.isArray(v) ? v : [];
    return items.map((item) => CorrectionItem.safeParse(item)).filter((r) => r.success).map((r) => r.data);
  }, z.array(z.any())),
  // Actions are best effort too: unknown or malformed ones are dropped.
  actions: z.preprocess((v) => {
    const items = Array.isArray(v) ? v : [];
    return items.map((item) => ActionItem.safeParse(item)).filter((r) => r.success).map((r) => r.data);
  }, z.array(z.any())).default([]),
});

/** One LLM call per learner turn: the in-character reply plus corrections of the learner's message. */
@Injectable()
export class TutorService {
  private readonly logger = new Logger('Tutor');

  constructor(private readonly llm: LlmClient) {}

  async respond(
    scenario: Scenario,
    history: { role: 'user' | 'ai'; text: string }[],
    learnerText: string,
    spokenLanguage: string,
    memory: TutorMemory = { recentMistakes: [], recentWords: [], goalsAchieved: [] },
  ): Promise<TutorResult> {
    const learnerLanguage = LANGUAGE_NAMES[spokenLanguage] ?? 'English';
    const system = [
      `You are playing a role in a German speaking practice for a ${scenario.level} learner.`,
      `Scene: ${scenario.situation}`,
      `The learner is ${scenario.youAre}. You are ${scenario.aiIs}.`,
      `Character notes: ${scenario.aiPersona}`,
      '',
      'Each time, do two things:',
      `1. "reply": your next line, IN GERMAN ONLY, in character, simple enough for CEFR ${scenario.level}: 1-2 short sentences.`,
      '   Keep the scene moving and usually end with a question. Never explain grammar in the reply and never switch language.',
      '2. Check the learner\'s LAST message only:',
      '   - "understood": true whenever you can tell what they meant, EVEN IF it has mistakes. false only if the message is',
      '     meaningless or unrelated (then your reply politely asks them to say it again).',
      `   - "corrections": up to 3 real mistakes that matter at ${scenario.level}, most important first. For each: "original" (their`,
      '     wrong words), "corrected" (correct German), "ruleKey" (short English kebab-case id, e.g. "verb-second"),',
      `     "ruleName" (short label in ${learnerLanguage}) and "explanation" (ONE short sentence in ${learnerLanguage}: why).`,
      '   - Their message is a speech transcript: ignore punctuation and capitalisation. Only correct real errors: never',
      '     "correct" German that is already right, and never swap a correct wording for another correct one (e.g. "habe',
      '     gehabt" vs "hatte" are both fine). If there are no mistakes, use an empty list.',
      `3. "actions": tools you may use (at most ${MAX_ACTIONS}, often none):`,
      '   - {"type":"word","lemma":"Kaution","save":true}: show a word card. Use it when the learner asks what a word means or',
      '     how to say something, or uses a useful new word. "save": true only if they asked about it or asked to save it.',
      '   - {"type":"play","text":"Die Rechnung, bitte."}: let the learner hear a short German phrase they asked how to say.',
      `   - {"type":"grammar","ruleKey":"...","ruleName":"...","explanation":"...","examples":["..."]}: a grammar card (in ${learnerLanguage},`,
      '     examples in German). ALWAYS add one when the learner asks why/how something works in German (e.g. "warum",',
      '     "wieso", "why"); answer the question in the card, and in your reply say briefly in German that you explained it.',
      '   - {"type":"goal","index":N}: EVERY turn, check each goal below that is not yet achieved. If the learner\'s last',
      '     message accomplishes it, add this action for it (several are allowed).',
      `   - {"type":"complete","reason":"..."}: the scene has naturally ended; reason in ${learnerLanguage}.`,
      '',
      'Scenario goals (index: goal):',
      ...scenario.goals.map((g, i) => `  ${i}: ${g}${memory.goalsAchieved.includes(i) ? ' (already achieved)' : ''}`),
      ...(memory.recentMistakes.length || memory.recentWords.length
        ? [
            '',
            'About this learner (use it naturally, e.g. create chances to practise; never list it back to them):',
            ...(memory.recentMistakes.length ? [`  Recent mistakes: ${memory.recentMistakes.join('; ')}`] : []),
            ...(memory.recentWords.length ? [`  Words they are learning: ${memory.recentWords.join(', ')}`] : []),
          ]
        : []),
      '',
      'Respond with only one JSON object, for example:',
      '{"reply":"Das tut mir leid. Seit wann haben Sie Fieber?","understood":true,"corrections":[{"original":"Ich habe gegeht",' +
        '"corrected":"Ich bin gegangen","ruleKey":"perfekt-sein-movement","ruleName":"Perfekt with sein",' +
        '"explanation":"Movement verbs take sein in the Perfekt; gehen becomes gegangen."}],"actions":[{"type":"goal","index":0}]}',
    ].join('\n');

    const recent = history.slice(-HISTORY_WINDOW);
    const prompt = [
      'Conversation so far:',
      ...recent.map((t) => `${t.role === 'ai' ? 'You' : 'Learner'}: ${t.text}`),
      `Learner: ${learnerText}`,
    ].join('\n');

    let res = await this.llm.generate({ task: 'roleplay_turn', system, prompt, maxTokens: MAX_TOKENS, temperature: 0.4, json: true });
    let parsed = TutorSchema.safeParse(parseJson(res.text));
    if (!parsed.success) {
      this.logger.warn('invalid tutor output, retrying once');
      await this.llm.markInvalid(res.callId, 'invalid tutor output');
      res = await this.llm.generate({ task: 'roleplay_turn', system, prompt, maxTokens: MAX_TOKENS, temperature: 0.2, json: true });
      parsed = TutorSchema.safeParse(parseJson(res.text));
    }
    if (!parsed.success) {
      await this.llm.markInvalid(res.callId, 'invalid tutor output after retry');
      throw new Error(`invalid tutor output: ${res.text.slice(0, 200)}`);
    }

    return {
      reply: parsed.data.reply,
      understood: parsed.data.understood,
      corrections: plausibleCorrections(parsed.data.corrections as TutorCorrection[], learnerText, parsed.data.understood),
      actions: (parsed.data.actions as TutorAction[]).slice(0, MAX_ACTIONS),
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
    };
  }
}

const normalise = (v: string) =>
  v
    .toLowerCase()
    .replace(/[.,!?;:„“"'()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Guards against model mistakes that code can catch: corrections of a message the tutor
 * didn't understand, corrections quoting words the learner never said, and "corrections"
 * that change nothing. At most 3 survive.
 */
export function plausibleCorrections(items: TutorCorrection[], learnerText: string, understood: boolean): TutorCorrection[] {
  if (!understood) return [];
  const said = normalise(learnerText);
  return items
    .filter((c) => {
      const original = normalise(c.original);
      return original.length > 0 && said.includes(original) && original !== normalise(c.corrected);
    })
    .slice(0, 3);
}

/** The outermost JSON object in the model output; salvages the reply if the JSON is broken. */
function parseJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // fall through to salvage
    }
  }
  const reply = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
  if (!reply) return null;
  const understood = /"understood"\s*:\s*(true|false)/.exec(text)?.[1];
  return { reply: reply.replace(/\\"/g, '"'), understood: understood !== 'false', corrections: [] };
}
