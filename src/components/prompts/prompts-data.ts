export type Prompt = {
  id: string;
  title: string;
  description?: string;
  content: string;
};

export type PromptCategory = {
  id: string;
  label: string;
  description?: string;
  prompts: Prompt[];
};

const yaRomanceFullPreset = `Genre and voice: Casual romantic, young-adult register. Accessible, fresh, a little wry. Avoid purple prose, literary-fiction density, and operatic phrasing.

Pacing: Move quickly. Cut filler dialogue, scenic dawdling, and circling around the same idea. Every paragraph should advance the beat, reveal character, or shift the emotional state. If a line can be cut without losing meaning, cut it.

Characters: Distinct personalities and consistent quirks. Reactions should feel like *this* character specifically — shaped by their own history, hangups, and way of seeing things. Avoid generic love-interest tropes and stock emotional responses. Let characters disagree, misread each other, and make small messy choices like real people.

First-person immersion: When the manuscript is in first person, write deep POV. The reader should feel like they *are* the narrator — inside the body and the head. Lean on embodied sensation, immediate interior reaction, and thought-in-the-moment fragments. In charged or intimate beats (a kiss, a touch, a vulnerable confession), prioritize what the narrator notices, feels physically, and thinks in flashes over external description of the scene. Camera-distance description pulls the reader out; sensory and interior anchoring pulls them in.`;

const yaRomanceLeanPreset = `YA romantic short fiction. Move fast — no filler dialogue or scenic dawdling. Every line should advance the beat or reveal character. Distinct, specific personalities; no stock love-interest tropes. In first person, write deep POV: embodied sensation, interior fragments, thought-in-the-moment over external scene description. Keep the voice fresh and slightly wry; avoid purple prose.`;

export const PROMPT_CATEGORIES: PromptCategory[] = [
  {
    id: "global-presets",
    label: "Writer Global System Instructions",
    description:
      "Full presets for the Settings → Writer Global System Instructions field. Persist across every generation in every story.",
    prompts: [
      {
        id: "ya-romance-full",
        title: "YA Romance — full preset",
        description:
          "Comprehensive voice, pacing, character, and first-person immersion preferences for casual romantic YA short fiction.",
        content: yaRomanceFullPreset,
      },
      {
        id: "ya-romance-lean",
        title: "YA Romance — lean preset",
        description:
          "A condensed single-paragraph version. Lower prompt overhead, less prescriptive.",
        content: yaRomanceLeanPreset,
      },
    ],
  },
  {
    id: "modular-voice",
    label: "Voice & Pacing",
    description:
      "Drop-in pieces for mixing your own preset, or for per-story system instructions.",
    prompts: [
      {
        id: "voice-ya-romance",
        title: "YA romance voice",
        description: "Voice and register only — no pacing or POV directives.",
        content:
          "Voice: Casual romantic, young-adult register. Accessible, fresh, a little wry. Avoid purple prose, literary-fiction density, and operatic phrasing. Reach for the simpler word when both fit.",
      },
      {
        id: "pacing-fast",
        title: "Fast pacing for short works",
        description:
          "Cut filler, keep every line load-bearing. Good for short fiction.",
        content:
          "Pacing: Move quickly. Cut filler dialogue, scenic dawdling, and circling around the same idea. Every paragraph should advance the beat, reveal character, or shift the emotional state. If a line can be cut without losing meaning, cut it.",
      },
      {
        id: "characters-authentic",
        title: "Authentic, specific characters",
        description:
          "Push back on generic love-interest tropes and stock reactions.",
        content:
          "Characters: Distinct personalities and consistent quirks. Reactions should feel like *this* character specifically — shaped by their own history, hangups, and way of seeing things. Avoid generic love-interest tropes and stock emotional responses. Let characters disagree, misread each other, and make small messy choices like real people.",
      },
      {
        id: "pov-first-person-deep",
        title: "First-person deep POV",
        description:
          "Reader-as-narrator immersion. Especially useful for intimate beats.",
        content:
          "First-person immersion: When the manuscript is in first person, write deep POV. The reader should feel like they *are* the narrator — inside the body and the head. Lean on embodied sensation, immediate interior reaction, and thought-in-the-moment fragments. In charged or intimate beats (a kiss, a touch, a vulnerable confession), prioritize what the narrator notices, feels physically, and thinks in flashes over external description of the scene. Camera-distance description pulls the reader out; sensory and interior anchoring pulls them in.",
      },
      {
        id: "voice-young-female-narrator",
        title: "Young female narrator (tween / young teen)",
        description:
          "Voice for an 11–14 year old girl. Benchmark: she should feel like a real teen cousin you're actually talking to, not a TV idea of a teen girl. Especially important in first-person POV.",
        content:
          'Young female narrator voice (roughly 11–14): The benchmark is that the reader feels like they\'re hearing a real teen cousin — a specific, present, alive person — not a TV idea of a teen girl. Avoid both failure modes. Do not over-infantilize: no babyish vocabulary, no sing-song cadence, no choppy three-word sentences as a proxy for youth, no "yummy"/"potty"-tier word choice. She is sharper and more observant than adults assume; she notices hypocrisy, social hierarchy, body language, and what isn\'t being said. Equally, do not write her as a smaller adult. Her frame of reference is school, family, friend group, group chats, crushes, and inner life — not careers, mortgages, or politics. Her time scale is compressed: a week is long, a year is forever, a bad lunch period can ruin a day. Her emotions are bigger and less buffered — embarrassment is annihilating, "cringe" is a real threat, a small slight from a friend cuts deep, a crush is total.\n\nFemale-coded texture: friendships are emotionally intense and politically layered — she tracks who\'s in and who\'s out, who texted whom, who\'s mad at whom and why. She\'s increasingly aware of how she\'s seen, comparing herself to other girls, half-performing an identity through clothes, posts, music, and who she sits with. Group chats and DMs are a real social arena, not background. Hyperbole and intensifiers are natural register ("literally," "I\'m gonna die," "I\'m not even joking"). She borrows phrases from older girls and the internet without fully owning them, and sometimes uses a big word slightly wrong. Metaphors come from her actual experience world — school, friends, what she\'s watching, what\'s on her phone — not from literary references.\n\nIn first person, show what she doesn\'t yet have words for by letting her reach for it and approximate; that gap is where the voice lives. Trust her with complexity, but route it through a partial, still-forming frame. Default to specifics over types: not "her crush" but the thing he did in math today; not "her friend" but the friend who\'s been weird since Tuesday. Specificity is what makes her feel like someone you actually know.',
      },
    ],
  },
  {
    id: "per-generation-briefs",
    label: "Per-Generation Briefs",
    description:
      "Short directives to paste into the writer brief for a single generation.",
    prompts: [
      {
        id: "brief-continue-no-ending",
        title: "Continue, no ending",
        description:
          "Reinforce mid-scene continuation when the model keeps trying to wrap.",
        content:
          "Continue the scene mid-momentum. Do not write any scene or chapter ending, closing kicker, or resonant final line. Leave the moment open and continuable; stop on a complete sentence with tension or motion intact.",
      },
      {
        id: "brief-slow-burn",
        title: "Slow-burn tension",
        description:
          "For romantic beats where you want pressure without resolution.",
        content:
          "Hold the romantic tension but do not resolve it. No kiss, no confession, no breakthrough this beat. Build proximity, charged glances, and small physical awareness; let the unresolved want do the work.",
      },
      {
        id: "brief-interior-beat",
        title: "Interior beat",
        description: "Shift the camera inward — thought, sensation, reaction.",
        content:
          "This is an interior beat. Stay inside the narrator's head and body. Short, fragmentary thoughts; immediate sensory reaction; honest unspoken takes on what just happened. Minimal external action or description.",
      },
      {
        id: "brief-dialogue-driven",
        title: "Dialogue-driven scene",
        description:
          "Push the beat through speech, not narration. Keeps exchanges lean.",
        content:
          "Drive this beat through dialogue. Keep lines short and character-specific; let each line change the pressure of the scene. Use action beats sparingly and only when they carry meaning. No exposition dumps in speech.",
      },
      {
        id: "brief-physical-intimacy",
        title: "Physical intimacy — embodied",
        description:
          "For kisses, touches, charged closeness in first-person POV.",
        content:
          "Write this from fully inside the narrator. What they notice, where their attention catches, what their body does without permission, the thought-fragments that surface and break. Avoid camera-distance description of how they look together; avoid generic romance phrasings. Specific, sensory, immediate.",
      },
    ],
  },
];
