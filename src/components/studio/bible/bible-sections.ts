import type { StudioEntryDto, StudioEntryType } from "@/lib/studio/contracts";

export const BIBLE_OVERVIEW_SECTION = "overview";
export const BIBLE_INSTRUCTIONS_SECTION = "instructions";
export const BIBLE_STRUCTURE_SECTION = "structure";

export const BIBLE_STORY_SECTIONS = [
  { id: BIBLE_OVERVIEW_SECTION, label: "Overview" },
  { id: BIBLE_INSTRUCTIONS_SECTION, label: "Instructions & Style" },
  { id: BIBLE_STRUCTURE_SECTION, label: "Structure" },
] as const;

type BuiltInEntryType = Exclude<StudioEntryType, "custom">;

/** World sections for the built-in types; a section id is the entry type. */
export const BIBLE_WORLD_TYPES: {
  id: BuiltInEntryType;
  label: string;
  singular: string;
}[] = [
  { id: "character", label: "Characters", singular: "character" },
  { id: "relationship", label: "Relationships", singular: "relationship" },
  { id: "place", label: "Places", singular: "place" },
  { id: "thing", label: "Things", singular: "thing" },
  { id: "lore", label: "Lore & rules", singular: "lore entry" },
];

const CUSTOM_PREFIX = "custom:";

export function customSectionId(label: string): string {
  return `${CUSTOM_PREFIX}${label.trim().toLowerCase()}`;
}

export function isStorySection(section: string): boolean {
  return BIBLE_STORY_SECTIONS.some((item) => item.id === section);
}

/** The section an entry is listed under. */
export function sectionOfEntry(entry: StudioEntryDto): string {
  return entry.type === "custom"
    ? customSectionId(entry.customTypeLabel)
    : entry.type;
}

export type BibleCustomGroup = { id: string; label: string };

/** One group per distinct custom type label, in first-seen order. */
export function customGroups(entries: StudioEntryDto[]): BibleCustomGroup[] {
  const groups = new Map<string, BibleCustomGroup>();
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    const id = customSectionId(entry.customTypeLabel);
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        label: entry.customTypeLabel.trim() || "Custom",
      });
    }
  }
  return [...groups.values()];
}

export function entriesInSection(
  entries: StudioEntryDto[],
  section: string,
): StudioEntryDto[] {
  return entries
    .filter((entry) => sectionOfEntry(entry) === section)
    .sort(
      (a, b) =>
        a.position - b.position ||
        (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0),
    );
}
