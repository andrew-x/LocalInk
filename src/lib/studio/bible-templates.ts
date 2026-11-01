import type {
  StudioAspect,
  StudioEntryType,
  StudioPlanKind,
  StudioStructureTemplateId,
} from "@/lib/studio/contracts";

export type StudioEntryFieldTemplate = {
  key: string;
  label: string;
  hint: string;
  group: "fixed" | "voice";
  /** Steers generation but must never appear as narration. */
  neverSays?: true;
  /** Only relevant to backstory scenes; never surfaces in present-day prose. */
  backstoryOnly?: true;
};

export const STUDIO_ENTRY_TEMPLATES: Record<
  StudioEntryType,
  { label: string; fields: StudioEntryFieldTemplate[] }
> = {
  character: {
    label: "Character",
    fields: [
      { key: "age", label: "Age", hint: "How old they are.", group: "fixed" },
      {
        key: "role",
        label: "Role",
        hint: "Who they are in the story.",
        group: "fixed",
      },
      {
        key: "shows",
        label: "What they show people",
        hint: "The face they present to others.",
        group: "fixed",
      },
      {
        key: "underneath",
        label: "What's underneath",
        hint: "What they hide or don't admit.",
        group: "fixed",
      },
      {
        key: "wants",
        label: "What they want",
        hint: "The goal they consciously chase.",
        group: "fixed",
      },
      {
        key: "needs",
        label: "What they need",
        hint: "What would actually fix things for them.",
        group: "fixed",
        neverSays: true,
      },
      {
        key: "falseBelief",
        label: "False belief",
        hint: "The wrong idea about themselves or the world that drives them.",
        group: "fixed",
        neverSays: true,
      },
      {
        key: "beliefOrigin",
        label: "Where the belief came from",
        hint: "The past event that planted it.",
        group: "fixed",
        neverSays: true,
        backstoryOnly: true,
      },
      {
        key: "contradiction",
        label: "A contradiction",
        hint: "Something about them that doesn't fit.",
        group: "fixed",
      },
      {
        key: "talks",
        label: "How they talk",
        hint: "Rhythm, slang, habits of speech.",
        group: "voice",
      },
      {
        key: "wouldSay",
        label: "A line they'd say",
        hint: "A sample line that sounds like them.",
        group: "voice",
      },
      {
        key: "wouldNeverSay",
        label: "A line they'd never say",
        hint: "Something out of character.",
        group: "voice",
      },
      {
        key: "notices",
        label: "What they notice",
        hint: "What catches their eye first.",
        group: "voice",
      },
      {
        key: "carries",
        label: "Objects they carry",
        hint: "Things always on them.",
        group: "voice",
      },
      {
        key: "doesntKnowYet",
        label: "What they don't know yet",
        hint: "Blind spots.",
        group: "voice",
      },
    ],
  },
  relationship: {
    label: "Relationship",
    fields: [
      {
        key: "insideObstacle",
        label: "What's in the way inside",
        hint: "How their beliefs collide.",
        group: "fixed",
      },
      {
        key: "outsideObstacle",
        label: "What's in the way outside",
        hint: "Circumstances keeping them apart.",
        group: "fixed",
      },
      {
        key: "aSeesInB",
        label: "What the first sees in the second",
        hint: "What draws them in.",
        group: "fixed",
      },
      {
        key: "bSeesInA",
        label: "What the second sees in the first",
        hint: "What draws them in.",
        group: "fixed",
      },
      {
        key: "unsaid",
        label: "What's unsaid",
        hint: "What neither will say aloud yet.",
        group: "fixed",
      },
    ],
  },
  place: {
    label: "Place",
    fields: [
      {
        key: "whatItIs",
        label: "What it is",
        hint: "A plain description.",
        group: "fixed",
      },
      {
        key: "detailsToUse",
        label: "Details to use",
        hint: "Specific sensory details.",
        group: "fixed",
      },
      {
        key: "whoGoesThere",
        label: "Who goes there",
        hint: "Who is found here and why.",
        group: "fixed",
      },
    ],
  },
  thing: {
    label: "Thing",
    fields: [
      {
        key: "description",
        label: "Description",
        hint: "What it is and looks like.",
        group: "fixed",
      },
      {
        key: "whyItMatters",
        label: "Why it matters",
        hint: "Its role in the story.",
        group: "fixed",
      },
    ],
  },
  lore: {
    label: "Lore and rules",
    fields: [
      {
        key: "description",
        label: "Description",
        hint: "What this is.",
        group: "fixed",
      },
      {
        key: "rules",
        label: "Rules",
        hint: "How it works and its limits.",
        group: "fixed",
      },
    ],
  },
  custom: {
    label: "Custom",
    fields: [
      {
        key: "description",
        label: "Description",
        hint: "What this is.",
        group: "fixed",
      },
      {
        key: "details",
        label: "Details",
        hint: "Specifics worth remembering.",
        group: "fixed",
      },
      {
        key: "notes",
        label: "Notes",
        hint: "Anything else.",
        group: "fixed",
      },
    ],
  },
};

export const STUDIO_ASPECTS: {
  key: StudioAspect;
  label: string;
  accumulates: boolean;
}[] = [
  { key: "believes", label: "Believes", accumulates: false },
  { key: "wants", label: "Wants", accumulates: false },
  { key: "knows", label: "Knows", accumulates: true },
  { key: "feels", label: "Feels about", accumulates: false },
  { key: "where", label: "Is at", accumulates: false },
  { key: "status", label: "Status", accumulates: false },
  { key: "looks", label: "Looks", accumulates: false },
  { key: "note", label: "Note", accumulates: true },
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
