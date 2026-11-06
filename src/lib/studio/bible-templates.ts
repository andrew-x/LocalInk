import type {
  StudioChangeMode,
  StudioEntryType,
  StudioPlanKind,
  StudioStructureTemplateId,
} from "@/lib/studio/contracts";

export type StudioEntrySuggestion = {
  label: string;
  hint: string;
  /** Steers generation but must never appear as narration. */
  steerOnly: boolean;
  /** Only relevant to backstory scenes; never surfaces in present-day prose. */
  backstoryOnly: boolean;
  /** The pre-Amendment-A record key, used to convert legacy entries. */
  legacyKey?: string;
};

/**
 * Craft-informed examples of what is worth tracking, per entry type. They are
 * ideas for the model and quick-add chips for the author; nothing requires
 * them. Order matters: legacy entries convert in this order.
 */
export const STUDIO_ENTRY_SUGGESTIONS: Record<
  StudioEntryType,
  { label: string; suggestions: StudioEntrySuggestion[] }
> = {
  character: {
    label: "Character",
    suggestions: [
      {
        label: "Age",
        hint: "How old they are.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "age",
      },
      {
        label: "Role",
        hint: "Who they are in the story.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "role",
      },
      {
        label: "What they show people",
        hint: "The face they present to others.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "shows",
      },
      {
        label: "What's underneath",
        hint: "What they hide or don't admit.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "underneath",
      },
      {
        label: "What they want",
        hint: "The goal they consciously chase.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "wants",
      },
      {
        label: "What they need",
        hint: "What would actually fix things for them.",
        steerOnly: true,
        backstoryOnly: false,
        legacyKey: "needs",
      },
      {
        label: "False belief",
        hint: "The wrong idea about themselves or the world that drives them.",
        steerOnly: true,
        backstoryOnly: false,
        legacyKey: "falseBelief",
      },
      {
        label: "Where the belief came from",
        hint: "The past event that planted it.",
        steerOnly: true,
        backstoryOnly: true,
        legacyKey: "beliefOrigin",
      },
      {
        label: "A contradiction",
        hint: "Something about them that doesn't fit.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "contradiction",
      },
      {
        label: "How they talk",
        hint: "Rhythm, slang, habits of speech.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "talks",
      },
      {
        label: "A line they'd say",
        hint: "A sample line that sounds like them.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "wouldSay",
      },
      {
        label: "A line they'd never say",
        hint: "Something out of character.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "wouldNeverSay",
      },
      {
        label: "What they notice",
        hint: "What catches their eye first.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "notices",
      },
      {
        label: "Objects they carry",
        hint: "Things always on them.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "carries",
      },
      {
        label: "What they don't know yet",
        hint: "Blind spots.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "doesntKnowYet",
      },
      // Added after the legacy keys so legacy conversion order is unchanged.
      {
        label: "Look",
        hint: "Build, face, clothes, the one detail people remember.",
        steerOnly: false,
        backstoryOnly: false,
      },
      {
        label: "Daily life",
        hint: "Work, home, money, how an ordinary day goes.",
        steerOnly: false,
        backstoryOnly: false,
      },
      {
        label: "History",
        hint: "The past that made them, in a few concrete facts.",
        steerOnly: false,
        backstoryOnly: true,
      },
      {
        label: "Wound",
        hint: "The specific hurt they are still organized around.",
        steerOnly: true,
        backstoryOnly: true,
      },
      {
        label: "What they fear",
        hint: "What they would do almost anything to avoid.",
        steerOnly: true,
        backstoryOnly: false,
      },
      {
        label: "Habits and tells",
        hint: "Gestures, routines, what they do when nervous or lying.",
        steerOnly: false,
        backstoryOnly: false,
      },
      {
        label: "What they won't do",
        hint: "A line they hold, and what it would take to cross it.",
        steerOnly: false,
        backstoryOnly: false,
      },
      {
        label: "Good at",
        hint: "Skills and competence that show in scenes.",
        steerOnly: false,
        backstoryOnly: false,
      },
      {
        label: "How others see them",
        hint: "Their reputation, and where it is wrong.",
        steerOnly: false,
        backstoryOnly: false,
      },
    ],
  },
  relationship: {
    label: "Relationship",
    suggestions: [
      {
        label: "What's in the way inside",
        hint: "How their beliefs collide.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "insideObstacle",
      },
      {
        label: "What's in the way outside",
        hint: "Circumstances keeping them apart.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "outsideObstacle",
      },
      {
        label: "What the first sees in the second",
        hint: "What draws them in.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "aSeesInB",
      },
      {
        label: "What the second sees in the first",
        hint: "What draws them in.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "bSeesInA",
      },
      {
        label: "What's unsaid",
        hint: "What neither will say aloud yet.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "unsaid",
      },
    ],
  },
  place: {
    label: "Place",
    suggestions: [
      {
        label: "What it is",
        hint: "A plain description.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "whatItIs",
      },
      {
        label: "Details to use",
        hint: "Specific sensory details.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "detailsToUse",
      },
      {
        label: "Who goes there",
        hint: "Who is found here and why.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "whoGoesThere",
      },
      // Added after the legacy keys so legacy conversion order is unchanged.
      {
        label: "Layout",
        hint: "How it is laid out and how people move through it.",
        steerOnly: false,
        backstoryOnly: false,
      },
      {
        label: "Sounds and smells",
        hint: "What you hear and smell here, beyond what you see.",
        steerOnly: false,
        backstoryOnly: false,
      },
      {
        label: "Over a day",
        hint: "How it changes with the hour, the weather, or the season.",
        steerOnly: false,
        backstoryOnly: false,
      },
      {
        label: "What happens there",
        hint: "What people do here, and what the story uses it for.",
        steerOnly: false,
        backstoryOnly: false,
      },
      {
        label: "Rules and routines",
        hint: "Who is allowed where, opening hours, unspoken customs.",
        steerOnly: false,
        backstoryOnly: false,
      },
      {
        label: "History",
        hint: "What happened here before the story, in a few concrete facts.",
        steerOnly: false,
        backstoryOnly: true,
      },
      {
        label: "What it means to them",
        hint: "What this place stands for to the people in it.",
        steerOnly: true,
        backstoryOnly: false,
      },
      {
        label: "What can go wrong here",
        hint: "Dangers, breakdowns, the ways it can trap or expose someone.",
        steerOnly: false,
        backstoryOnly: false,
      },
    ],
  },
  thing: {
    label: "Thing",
    suggestions: [
      {
        label: "Description",
        hint: "What it is and looks like.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "description",
      },
      {
        label: "Why it matters",
        hint: "Its role in the story.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "whyItMatters",
      },
    ],
  },
  lore: {
    label: "Lore and rules",
    suggestions: [
      {
        label: "Description",
        hint: "What this is.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "description",
      },
      {
        label: "Rules",
        hint: "How it works and its limits.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "rules",
      },
    ],
  },
  custom: {
    label: "Custom",
    suggestions: [
      {
        label: "Description",
        hint: "What this is.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "description",
      },
      {
        label: "Details",
        hint: "Specifics worth remembering.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "details",
      },
      {
        label: "Notes",
        hint: "Anything else.",
        steerOnly: false,
        backstoryOnly: false,
        legacyKey: "notes",
      },
    ],
  },
};

/** Examples only. Aspects are free-text labels; these seed prompts and the form. */
export const STUDIO_ASPECT_SUGGESTIONS: {
  label: string;
  mode: StudioChangeMode;
  hint: string;
  /** The stored key older stories used for this idea; never renamed. */
  legacyKey?: string;
}[] = [
  {
    label: "Believes",
    mode: "set",
    hint: "what they hold to be true",
    legacyKey: "believes",
  },
  {
    label: "Wants",
    mode: "set",
    hint: "what they are after right now",
    legacyKey: "wants",
  },
  {
    label: "Knows",
    mode: "add",
    hint: "facts and secrets they have learned",
    legacyKey: "knows",
  },
  {
    label: "Feels about",
    mode: "set",
    hint: "feelings toward another entry",
    legacyKey: "feels",
  },
  { label: "Is at", mode: "set", hint: "where they are", legacyKey: "where" },
  {
    label: "Status",
    mode: "set",
    hint: "their standing or condition",
    legacyKey: "status",
  },
  { label: "Looks", mode: "set", hint: "how they appear", legacyKey: "looks" },
  { label: "Promises", mode: "add", hint: "promises made or owed" },
  {
    label: "Note",
    mode: "add",
    hint: "anything else worth tracking",
    legacyKey: "note",
  },
];

export const STUDIO_STRUCTURE_TEMPLATES: {
  id: StudioStructureTemplateId;
  label: string;
  guidance: string;
}[] = [
  {
    id: "romance",
    label: "Romance",
    guidance:
      "Four phases: setup, falling, retreating, fighting. Setup shows each lead's life and wound, then they meet and are forced into contact. In the falling phase they grow closer and the first real intimacy arrives. The retreat comes from an inner fear, not a misunderstanding, and the final phase has each lead face that fear and choose the other. The breakup beat can be an internal withdrawal rather than a fight.",
  },
  {
    id: "coming-of-age",
    label: "Coming of age",
    guidance:
      "A rite of passage. The protagonist begins inside a way of seeing the world that no longer fits, meets a threshold event that breaks it, and tries the old way harder before it fails. The turn is a recognition of the true problem, then a change that costs something. End on a changed relationship to the same ordinary life, not a victory.",
  },
  {
    id: "quiet",
    label: "Quiet story",
    guidance:
      "Four movements in the manner of kishotenketsu: introduction, development, turn, reconciliation. Introduction and development establish people and place with little conflict. The turn is a reframe that recasts what came before without a villain or crisis. The final movement lets the two views sit together and resolves gently.",
  },
  {
    id: "freeform",
    label: "Freeform",
    guidance:
      "No prescribed beats. Plan scenes by cause and consequence: each scene turns something and leads to the next with but or therefore, never and then. Keep the protagonist's want and the pressure against it clear, and let the ending follow from what the story has set up.",
  },
];

export const STUDIO_CRAFT_FIELDS: Record<
  StudioPlanKind,
  { key: string; label: string }[]
> = {
  chapter: [
    { key: "purpose", label: "Purpose" },
    { key: "endHook", label: "End hook" },
  ],
  scene: [
    { key: "wants", label: "Who wants what" },
    { key: "goesWrong", label: "What goes wrong" },
    { key: "differentAfter", label: "What's different after" },
    { key: "entry", label: "Entry" },
    { key: "exit", label: "Exit" },
  ],
  moment: [
    { key: "turn", label: "The turn" },
    { key: "said", label: "What's said" },
    { key: "meant", label: "What's meant" },
    { key: "endsWith", label: "Ends with" },
  ],
};
