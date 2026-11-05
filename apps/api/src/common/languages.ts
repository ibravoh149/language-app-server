/**
 * Languages. Sprachbar is multi-language: German is the first language learners can
 * learn, not the only one (D29). Anything specific to a target language lives here,
 * so adding one means adding a TARGETS entry plus its content (BACKLOG B-LANG-1).
 */

/** Languages a learner can speak or see the interface in. */
export const LANGS = ['en', 'de', 'fr', 'es', 'tr', 'ar'] as const;

const NAMES: Record<string, string> = {
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', tr: 'Turkish', ar: 'Arabic',
};

/** English name of a language code, for prompts. */
export const languageName = (code: string, fallback = 'English') => NAMES[code] ?? fallback;

/** Prompt details that differ per target language. Examples must be correct in that language. */
export interface TargetLanguageProfile {
  /** English name, used in prompts. */
  name: string;
  /** Definite articles shown with nouns, lowercase; empty if the language has none. */
  articles: string[];
  /** One key word-order or grammar fact the placement scorer should treat as a major error. */
  keyGrammar: string;
  tutor: {
    /** A noun for the word-card example. */
    exampleWord: string;
    /** A short phrase for the play example. */
    examplePhrase: string;
    /** How learners ask "why" in this language, for the grammar-card rule. */
    whyWords: string;
    /** Two correct wordings of the same thing, so the model doesn't "correct" one into the other. */
    bothCorrect: string;
    /** A complete example response (JSON), corrections explained in English. */
    exampleResponse: string;
  };
  /** How the dictionary writes a base form. */
  lemmaForm: string;
  /** A complete example dictionary entry (JSON) with an English meaning. */
  dictionaryExample: string;
}

export const TARGETS = {
  de: {
    name: 'German',
    articles: ['der', 'die', 'das'],
    keyGrammar: 'German puts the verb second',
    tutor: {
      exampleWord: 'Kaution',
      examplePhrase: 'Die Rechnung, bitte.',
      whyWords: '"warum", "wieso"',
      bothCorrect: '"habe gehabt" vs "hatte"',
      exampleResponse:
        '{"reply":"Das tut mir leid. Seit wann haben Sie Fieber?","understood":true,"corrections":[{"original":"Ich habe gegeht",' +
        '"corrected":"Ich bin gegangen","ruleKey":"perfekt-sein-movement","ruleName":"Perfekt with sein",' +
        '"explanation":"Movement verbs take sein in the Perfekt; gehen becomes gegangen."}],"actions":[{"type":"goal","index":0}]}',
    },
    lemmaForm: 'nouns capitalised, verbs in the infinitive',
    dictionaryExample:
      '{"lemma":"Bahnhof","article":"der","plural":"Bahnhöfe","partOfSpeech":"noun","meaning":"train station","example":"Der Bahnhof ist nicht weit."}',
  },
} satisfies Record<string, TargetLanguageProfile>;

/** Languages learners can learn. Only these are accepted from clients. */
export const TARGET_LANGUAGES = Object.keys(TARGETS) as [TargetLanguage, ...TargetLanguage[]];
export type TargetLanguage = keyof typeof TARGETS;

/** The profile for a stored target-language code; unknown codes fall back to German, the first language. */
export const targetProfile = (code: string): TargetLanguageProfile => TARGETS[code as TargetLanguage] ?? TARGETS.de;
