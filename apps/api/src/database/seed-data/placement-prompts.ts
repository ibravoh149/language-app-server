// Placement prompt bank (spoken language → level → sentences to say in German).
// Seeded from the mobile mock fixtures; these are starter items, not validated
// assessment content (BACKLOG B-PLAT-1). Edit here, then run `yarn db:seed`.
export const PLACEMENT_PROMPTS: Record<string, Record<'A1' | 'A2' | 'B1' | 'B2' | 'C1', string[]>> = {
  "en": {
    "A1": [
      "My name is Alex.",
      "I live in Berlin."
    ],
    "A2": [
      "I would like a coffee and a glass of water, please.",
      "Where is the nearest train station?"
    ],
    "B1": [
      "I've lived in Berlin for two years, but I used to live in a small town.",
      "Last weekend I visited a friend and we cooked dinner together."
    ],
    "B2": [
      "Although working from home is convenient, I prefer meeting my colleagues in person.",
      "If public transport were more reliable, more people would leave their cars at home."
    ],
    "C1": [
      "Despite its short-term advantages, this proposal may have consequences we have not yet considered.",
      "The success of this policy depends not merely on funding, but on whether it earns lasting public trust."
    ]
  },
  "de": {
    "A1": [
      "Ich heiße Alex.",
      "Ich wohne in Berlin."
    ],
    "A2": [
      "Ich hätte gern einen Kaffee und ein Glas Wasser, bitte.",
      "Wo ist der nächste Bahnhof?"
    ],
    "B1": [
      "Ich lebe seit zwei Jahren in Berlin, aber früher habe ich in einer Kleinstadt gewohnt.",
      "Letztes Wochenende habe ich einen Freund besucht und wir haben zusammen gekocht."
    ],
    "B2": [
      "Obwohl die Arbeit von zu Hause bequem ist, treffe ich meine Kollegen lieber persönlich.",
      "Wenn öffentliche Verkehrsmittel zuverlässiger wären, würden mehr Menschen ihr Auto zu Hause lassen."
    ],
    "C1": [
      "Trotz ihrer kurzfristigen Vorteile könnte diese Maßnahme Folgen haben, die wir noch nicht bedacht haben.",
      "Der Erfolg dieser Politik hängt nicht nur von der Finanzierung ab, sondern auch davon, ob sie dauerhaftes öffentliches Vertrauen gewinnt."
    ]
  },
  "fr": {
    "A1": [
      "Je m'appelle Alex.",
      "J'habite à Berlin."
    ],
    "A2": [
      "Je voudrais un café et un verre d'eau, s'il vous plaît.",
      "Où est la gare la plus proche ?"
    ],
    "B1": [
      "J'habite à Berlin depuis deux ans, mais avant, je vivais dans une petite ville.",
      "Le week-end dernier, j'ai rendu visite à un ami et nous avons préparé le dîner ensemble."
    ],
    "B2": [
      "Même si travailler chez soi est pratique, je préfère voir mes collègues en personne.",
      "Si les transports en commun étaient plus fiables, davantage de personnes laisseraient leur voiture chez elles."
    ],
    "C1": [
      "Malgré ses avantages à court terme, cette proposition pourrait avoir des conséquences encore ignorées.",
      "Le succès de cette politique dépend non seulement du financement, mais aussi de sa capacité à gagner durablement la confiance du public."
    ]
  },
  "es": {
    "A1": [
      "Me llamo Alex.",
      "Vivo en Berlín."
    ],
    "A2": [
      "Quisiera un café y un vaso de agua, por favor.",
      "¿Dónde está la estación de tren más cercana?"
    ],
    "B1": [
      "Vivo en Berlín desde hace dos años, pero antes vivía en un pueblo.",
      "El fin de semana pasado visité a un amigo y preparamos la cena juntos."
    ],
    "B2": [
      "Aunque trabajar desde casa es cómodo, prefiero reunirme con mis compañeros en persona.",
      "Si el transporte público fuera más fiable, más personas dejarían el coche en casa."
    ],
    "C1": [
      "A pesar de sus ventajas a corto plazo, esta propuesta podría tener consecuencias que aún no hemos considerado.",
      "El éxito de esta política depende no solo de la financiación, sino también de que logre ganarse una confianza pública duradera."
    ]
  },
  "tr": {
    "A1": [
      "Benim adım Alex.",
      "Berlin'de yaşıyorum."
    ],
    "A2": [
      "Bir kahve ve bir bardak su rica ediyorum.",
      "En yakın tren istasyonu nerede?"
    ],
    "B1": [
      "İki yıldır Berlin'de yaşıyorum ama eskiden küçük bir kasabada yaşıyordum.",
      "Geçen hafta sonu bir arkadaşımı ziyaret ettim ve birlikte akşam yemeği hazırladık."
    ],
    "B2": [
      "Evden çalışmak rahat olsa da iş arkadaşlarımla yüz yüze görüşmeyi tercih ederim.",
      "Toplu taşıma daha güvenilir olsaydı, daha fazla insan arabasını evde bırakırdı."
    ],
    "C1": [
      "Kısa vadeli avantajlarına rağmen bu önerinin henüz değerlendirmediğimiz sonuçları olabilir.",
      "Bu politikanın başarısı yalnızca finansmana değil, halkın kalıcı güvenini kazanıp kazanamayacağına da bağlıdır."
    ]
  },
  "ar": {
    "A1": [
      "اسمي أليكس.",
      "أعيش في برلين."
    ],
    "A2": [
      "أريد قهوة وكوب ماء، من فضلك.",
      "أين أقرب محطة قطار؟"
    ],
    "B1": [
      "أعيش في برلين منذ عامين، لكنني كنت أعيش في بلدة صغيرة.",
      "زرت صديقًا في نهاية الأسبوع الماضي وأعددنا العشاء معًا."
    ],
    "B2": [
      "رغم أن العمل من المنزل مريح، فإنني أفضل لقاء زملائي وجهًا لوجه.",
      "لو كانت وسائل النقل العام أكثر موثوقية، لترك المزيد من الناس سياراتهم في المنزل."
    ],
    "C1": [
      "رغم مزايا هذا الاقتراح على المدى القصير، فقد تكون له عواقب لم نأخذها بعين الاعتبار بعد.",
      "لا يعتمد نجاح هذه السياسة على التمويل فحسب، بل على قدرتها على كسب ثقة الجمهور على المدى الطويل."
    ]
  }
};
