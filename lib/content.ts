import twitterText from "twitter-text";
export type Mode = "before" | "after";
export type Language = "English" | "Telugu" | "Hindi";
export type Script = "native" | "roman";
export type Output = {
  id: string;
  title: string;
  text: string;
  warning?: string;
};
export type Kit = {
  mode: Mode;
  language: Language;
  script: Script;
  outputs: Output[];
  sample?: boolean;
  clarification?: string;
};
export const definitions = {
  before: [
    { id: "hook", title: "Opening hook" },
    { id: "outline", title: "Short outline" },
    { id: "shots", title: "Shot checklist" },
  ],
  after: [
    { id: "instagram", title: "Instagram caption" },
    { id: "youtubeTitle", title: "YouTube Shorts title" },
    { id: "youtubeDescription", title: "YouTube Shorts description" },
    { id: "x", title: "X post" },
  ],
};
export const samples: Record<Mode, string> = {
  before:
    "I want to film a friendly reel about making a quick mango yogurt bowl. Show the ingredients, mixing the yogurt, adding chopped mango, and the finished bowl. Keep it casual and easy to follow. My audience is people looking for simple breakfast ideas.",
  after:
    "I made a mango yogurt bowl with plain yogurt, chopped mango, and a little granola. I liked the contrast of creamy yogurt and crunchy granola. It is a simple breakfast idea, and viewers can use whichever fruit they have. Ask them what fruit they would choose. Keep it friendly and natural.",
};
const text = {
  English: {
    before: [
      "Your next breakfast idea? A mango yogurt bowl.",
      "Start with the finished bowl.\nIntroduce yogurt, mango, and granola.\nShow how everything comes together.\nFinish with a close-up and invite viewers to try their own fruit.",
      "□ Finished bowl close-up\n□ Ingredients on the counter\n□ Yogurt going into the bowl\n□ Adding mango and granola\n□ Final spoonful",
    ],
    after: [
      "Creamy yogurt, sweet mango, and a little granola crunch. A simple breakfast bowl you can make your own. What fruit would you add?\n\n#MangoBowl #BreakfastIdeas #SimpleRecipes",
      "Mango yogurt bowl with a little crunch",
      "Plain yogurt, chopped mango, and a little granola. Here is my simple breakfast bowl—use whichever fruit you have. What would you add?",
      "Made a mango yogurt bowl: creamy yogurt, chopped mango, and granola for crunch. Simple, easy to change up, and a good excuse to use the fruit you have. What would you add?",
    ],
  },
  Telugu: {
    native: {
      before: [
        "మీ తదుపరి బ్రేక్‌ఫాస్ట్ కోసం మామిడి పెరుగు బౌల్ ఎలా ఉంటుంది?",
        "ముందుగా సిద్ధమైన బౌల్‌ను చూపించండి.\nపెరుగు, మామిడి ముక్కలు, గ్రనోలాను పరిచయం చేయండి.\nవాటిని బౌల్‌లో వేసే విధానాన్ని చూపించండి.\nచివరగా ప్రేక్షకులు ఏ పండు వేస్తారో అడగండి.",
        "□ సిద్ధమైన బౌల్ క్లోజప్\n□ కావలసిన పదార్థాలు\n□ బౌల్‌లో పెరుగు వేయడం\n□ మామిడి, గ్రనోలా జోడించడం\n□ చివరి స్పూన్ క్లోజప్",
      ],
      after: [
        "మెత్తని పెరుగు, తియ్యని మామిడి ముక్కలు, కరకరలాడే గ్రనోలా! మీ దగ్గరున్న పండ్లతో కూడా ఈ బౌల్ చేసుకోవచ్చు. మీరు ఏ పండు వేస్తారు?\n\n#MangoBowl #BreakfastIdeas #TeluguFood",
        "మామిడి పెరుగు బౌల్ — గ్రనోలా క్రంచ్‌తో!",
        "పెరుగు, మామిడి ముక్కలు, కొద్దిగా గ్రనోలాతో చేసిన సులభమైన బ్రేక్‌ఫాస్ట్ బౌల్. మీ దగ్గరున్న పండ్లతో ప్రయత్నించండి. మీరు ఏ పండు వేస్తారు?",
        "పెరుగు, మామిడి ముక్కలు, కొంచెం గ్రనోలా—నా సింపుల్ బ్రేక్‌ఫాస్ట్ బౌల్! మీ దగ్గరున్న పండ్లతో చేసుకోవచ్చు. మీరు ఏ పండు వేస్తారు?",
      ],
    },
    roman: {
      before: [
        "Mee next breakfast ki mango yogurt bowl ela untundi?",
        "Munduga ready ayina bowl chupinchandi.\nPerugu, mamidi mukkalu, granola parichayam cheyandi.\nAnni bowl lo vese vidhanam chupinchandi.\nChivariga vaallu ye pandu vestaaro adagandi.",
        "□ Ready ayina bowl close-up\n□ Kaavalsina ingredients\n□ Bowl lo perugu veyadam\n□ Mamidi, granola add cheyadam\n□ Final spoon close-up",
      ],
      after: [
        "Creamy perugu, teeyani mamidi mukkalu, konchem granola crunch! Mee daggara unna pandlatho kuda try cheyochu. Meeru ye pandu vestaaru?\n\n#MangoBowl #BreakfastIdeas #TeluguFood",
        "Mango perugu bowl — konchem granola crunch!",
        "Perugu, mamidi mukkalu, konchem granola tho naa simple breakfast bowl. Mee daggara unna pandlatho try cheyandi. Meeru ye pandu vestaaru?",
        "Perugu + mamidi mukkalu + konchem granola crunch = naa simple breakfast bowl. Mee daggara unna pandlatho kuda chesukovachu. Meeru ye pandu vestaaru?",
      ],
    },
  },
  Hindi: {
    native: {
      before: [
        "अगले नाश्ते में मैंगो योगर्ट बाउल बनाएं?",
        "पहले तैयार बाउल दिखाएं।\nदही, आम और ग्रेनोला बताएं।\nसब कुछ बाउल में डालते हुए दिखाएं।\nआखिर में पूछें कि दर्शक कौन-सा फल डालेंगे।",
        "□ तैयार बाउल का क्लोज़अप\n□ सारी सामग्री\n□ बाउल में दही डालना\n□ आम और ग्रेनोला डालना\n□ आखिरी चम्मच का क्लोज़अप",
      ],
      after: [
        "क्रीमी दही, मीठा आम और थोड़ा ग्रेनोला क्रंच! घर में जो फल हैं, उनसे भी बना सकते हैं। आप कौन-सा फल डालेंगे?\n\n#MangoBowl #BreakfastIdeas #EasyBreakfast",
        "आम और दही का बाउल, ग्रेनोला क्रंच के साथ",
        "दही, कटे आम और थोड़े ग्रेनोला से बना मेरा आसान नाश्ता। अपने पसंद के फल के साथ ट्राई करें। आप क्या डालेंगे?",
        "दही, कटे आम और थोड़ा ग्रेनोला—मेरा सिंपल ब्रेकफास्ट बाउल! घर में जो फल हैं, उनसे भी बना सकते हैं। आप कौन-सा फल डालेंगे?",
      ],
    },
    roman: {
      before: [
        "Agla breakfast idea? Mango yogurt bowl!",
        "Pehle taiyaar bowl dikhao.\nDahi, aam aur granola introduce karo.\nSab bowl mein daalte hue dikhao.\nEnd mein poochho: aap kaunsa fruit daaloge?",
        "□ Ready bowl ka close-up\n□ Saari ingredients\n□ Bowl mein dahi daalna\n□ Aam aur granola add karna\n□ Last spoon ka close-up",
      ],
      after: [
        "Creamy dahi, meetha aam aur thoda granola crunch! Ghar mein jo fruit hai, usse bhi bana sakte ho. Tum kaunsa fruit add karoge?\n\n#MangoBowl #BreakfastIdeas #EasyBreakfast",
        "Mango yogurt bowl, thode granola crunch ke saath",
        "Dahi, kate aam aur thode granola se bana mera simple breakfast bowl. Apne favourite fruit ke saath try karo. Tum kya add karoge?",
        "Dahi + aam + thoda granola crunch. Bas, mera simple breakfast bowl! Ghar mein jo fruit hai, usse bhi bana sakte ho. Tum kaunsa fruit add karoge?",
      ],
    },
  },
};
export function exampleKit(
  mode: Mode,
  language: Language,
  script: Script,
): Kit {
  const values =
    language === "English" ? text.English[mode] : text[language][script][mode];
  return {
    mode,
    language,
    script,
    sample: true,
    outputs: definitions[mode].map((o, i) => ({ ...o, text: values[i] })),
  };
}
export function characterCount(value: string) {
  return Array.from(value).length;
}
export function hashtagCount(value: string) {
  return (value.match(/#[\p{L}\p{M}\p{N}_]+/gu) || []).length;
}
export function xCount(value: string) {
  return twitterText.parseTweet(value).weightedLength;
}
