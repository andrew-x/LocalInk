import { z } from "zod";

export const STUDIO_MOMENT_GENERATION_ID_HEADER = "X-Studio-Generation-Id";

/** The route's 409 code when a preceding beat's staged draft is gone. */
export const STUDIO_DRAFT_EXPIRED_CODE = "DRAFT_EXPIRED";

const id = z.string().trim().min(1).max(128);

export const studioMomentProseRequestSchema = z.object({
  storyId: id,
  momentId: id,
  /** Client-generated `generateId("studio-draft")`, fresh for every attempt. */
  generationId: id,
  attempt: z.enum(["first", "again"]),
  /**
   * Earlier beats of the same scene whose drafts are staged but not kept, in
   * beat order. Ids only: the server reads their text from staging.
   */
  precedingDrafts: z
    .array(z.object({ momentId: id, generationId: id }))
    .max(50),
  /** The author's one-off request for this pass. An empty note means none. */
  note: z.string().trim().max(300).nullable(),
});

export type StudioMomentProseRequest = z.infer<
  typeof studioMomentProseRequestSchema
>;
