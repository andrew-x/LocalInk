import { z } from "zod";

export const STUDIO_MOMENT_GENERATION_ID_HEADER = "X-Studio-Generation-Id";

const id = z.string().trim().min(1).max(128);

export const studioMomentProseRequestSchema = z.object({
  storyId: id,
  momentId: id,
  /** Client-generated `generateId("studio-draft")`, fresh for every attempt. */
  generationId: id,
  attempt: z.enum(["first", "again"]),
});

export type StudioMomentProseRequest = z.infer<
  typeof studioMomentProseRequestSchema
>;
