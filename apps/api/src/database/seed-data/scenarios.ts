// Roleplay scenarios, from the hi-fi prototype (Language_design_files/app/screens-batch1.jsx).
// Starter content: the German should be reviewed by a native speaker (BACKLOG B-PLAT-1).
// `aiPersona` is server-only: it tells the AI who to play and how to steer the scene.
// Seeded with `yarn db:seed`, which upserts by slug (edits here update existing rows).

type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

export interface ScenarioSeed {
  slug: string;
  title: string;
  subtitle: string;
  emoji: string;
  level: Level;
  estimatedMinutes: number;
  situation: string;
  youAre: string;
  aiIs: string;
  aiPersona: string;
  openingLine: string;
  goals: string[];
  words: { de: string; en: string }[];
  phrases: string[];
  grammar: string[];
}

export const SCENARIOS: ScenarioSeed[] = [
  {
    slug: 'doctor',
    title: 'At the doctor',
    subtitle: 'describe symptoms',
    emoji: '🏥',
    level: 'B1',
    estimatedMinutes: 5,
    situation:
      "You've had a headache since yesterday. You're at your GP describing your symptoms while the doctor asks follow-up questions.",
    youAre: 'the patient',
    aiIs: 'the doctor',
    aiPersona:
      'You are Dr. Weber, a friendly, calm GP in Berlin. Use "Sie". Ask one follow-up question at a time about the symptoms ' +
      '(since when, how strong, fever, nausea, sleep). After a few answers, give simple advice (rest, water, a painkiller, ' +
      'come back if it gets worse) and check the patient understood.',
    openingLine: 'Guten Tag! Bitte setzen Sie sich. Was kann ich für Sie tun?',
    goals: ['Explain what hurts and since when', 'Answer follow-ups (fever? nausea?)', 'Understand the advice you are given'],
    words: [
      { de: 'die Kopfschmerzen', en: 'headache' },
      { de: 'das Fieber', en: 'fever' },
      { de: 'die Übelkeit', en: 'nausea' },
      { de: 'seit', en: 'since' },
      { de: 'sich fühlen', en: 'to feel' },
    ],
    phrases: ['Ich habe seit gestern Kopfschmerzen.', 'Mir ist schlecht.', 'Was soll ich tun?'],
    grammar: ['Perfekt (haben/sein)', 'seit + Dativ'],
  },
  {
    slug: 'cafe',
    title: 'Order & complain',
    subtitle: 'café',
    emoji: '☕',
    level: 'A2',
    estimatedMinutes: 4,
    situation: 'You order a coffee and a cake, but the order arrives wrong. Politely sort it out with the waiter.',
    youAre: 'the customer',
    aiIs: 'the waiter',
    aiPersona:
      'You are a friendly, slightly busy waiter in a Berlin café. Use "Sie". Take the order. After the customer has ordered, ' +
      'on your next turn "bring" the order but get one item wrong (for example tea instead of coffee) so they can politely ' +
      'complain. Apologise and fix it. If they ask for the bill, tell them the total in euros.',
    openingLine: 'Hallo, herzlich willkommen! Was darf ich Ihnen bringen?',
    goals: ['Order a drink and something to eat', 'Politely point out the mistake', 'Ask for the bill'],
    words: [
      { de: 'bestellen', en: 'to order' },
      { de: 'die Rechnung', en: 'the bill' },
      { de: 'leider', en: 'unfortunately' },
      { de: 'stattdessen', en: 'instead' },
    ],
    phrases: ['Ich hätte gern einen Kaffee.', 'Das habe ich nicht bestellt.', 'Die Rechnung, bitte.'],
    grammar: ['hätte gern (polite)', 'Akkusativ'],
  },
  {
    slug: 'flat',
    title: 'Flat viewing',
    subtitle: 'ask the landlord',
    emoji: '🏠',
    level: 'B1',
    estimatedMinutes: 6,
    situation: "You're viewing a flat you might rent. Ask the landlord the questions that matter before you decide.",
    youAre: 'the prospective tenant',
    aiIs: 'the landlord',
    aiPersona:
      'You are Herr Schmidt, a polite landlord showing a two-room flat in Leipzig. Use "Sie". Facts: rent 750 € cold plus ' +
      '180 € Nebenkosten, deposit three months cold rent, available from the 1st of next month, fitted kitchen included, ' +
      'balcony, 3rd floor without a lift. Answer questions with these facts and ask the tenant one question back now and then ' +
      '(job, pets, move-in date).',
    openingLine: 'Guten Tag, kommen Sie herein! Das ist die Wohnung. Haben Sie Fragen?',
    goals: ['Ask about rent and extra costs', 'Ask what is included', 'Say whether you are interested'],
    words: [
      { de: 'die Miete', en: 'rent' },
      { de: 'die Nebenkosten', en: 'extra costs' },
      { de: 'die Kaution', en: 'deposit' },
      { de: 'frei', en: 'available' },
    ],
    phrases: ['Wie hoch ist die Miete?', 'Sind die Nebenkosten inklusive?', 'Ab wann ist die Wohnung frei?'],
    grammar: ['W-Fragen (question words)', 'Modalverben'],
  },
  {
    slug: 'train',
    title: 'Buy a train ticket',
    subtitle: 'at the ticket office',
    emoji: '🚆',
    level: 'A2',
    estimatedMinutes: 3,
    situation: 'You need a ticket to Hamburg today. Work out the right ticket and buy it.',
    youAre: 'the traveller',
    aiIs: 'the ticket assistant',
    aiPersona:
      'You are a helpful ticket assistant at the Deutsche Bahn counter in Berlin Hauptbahnhof. Use "Sie". Ask where and when ' +
      'they want to travel, single or return, and first or second class. A single second-class ticket to Hamburg costs ' +
      '59,90 €; the next train leaves at 14:32 from platform 7, direct, no change. Ask how they want to pay.',
    openingLine: 'Guten Tag! Wohin möchten Sie fahren?',
    goals: ['Say where and when you are going', 'Choose single or return', 'Pay'],
    words: [
      { de: 'die Fahrkarte', en: 'ticket' },
      { de: 'einfach', en: 'single' },
      { de: 'hin und zurück', en: 'return' },
      { de: 'umsteigen', en: 'to change trains' },
    ],
    phrases: ['Eine Fahrkarte nach Hamburg, bitte.', 'Einfach oder hin und zurück?', 'Muss ich umsteigen?'],
    grammar: ['nach + place', 'Präsens for future'],
  },
];
