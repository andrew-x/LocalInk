import { z } from "zod";

import { ActionError } from "@/lib/action-error";

const id = z.string().trim().min(1).max(128);

export const STUDIO_REWRITE_OPTION_COUNT = 1;
export const STUDIO_REWRITE_MAX_SELECTION_CHARS = 4000;
export const STUDIO_REWRITE_MAX_INSTRUCTION_CHARS = 500;

export const studioRewriteModeSchema = z.enum([
  "rewrite",
  "tighten",
  "subtext",
  "custom",
]);

export const studioRewriteRequestSchema = z
  .object({
    storyId: id,
    momentId: id,
    selectedText: z.string().min(1).max(STUDIO_REWRITE_MAX_SELECTION_CHARS),
    mode: studioRewriteModeSchema,
    instruction: z
      .string()
      .max(STUDIO_REWRITE_MAX_INSTRUCTION_CHARS)
      .optional(),
  })
  .refine(
    (request) =>
      request.mode !== "custom" ||
      (request.instruction ?? "").trim().length > 0,
    { message: "Custom rewrites need an instruction.", path: ["instruction"] },
  );

export type StudioRewriteRequest = z.infer<typeof studioRewriteRequestSchema>;
export type StudioRewriteMode = StudioRewriteRequest["mode"];

export type StudioRewriteResponse = { options: string[] };

/** Model output. Strict-mode compatible: no bounds, the count is checked below. */
export const studioRewriteOptionsSchema = z.object({
  options: z.array(z.string()),
});

export function normalizeStudioRewriteOptions(
  raw: z.infer<typeof studioRewriteOptionsSchema>,
): StudioRewriteResponse {
  const options = raw.options
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
  // The response keeps an array so the route contract stays stable; the
  // count is exactly one.
  if (options.length !== STUDIO_REWRITE_OPTION_COUNT) {
    throw new ActionError(
      "GENERATION_FAILED",
      "The model did not return a usable rewrite. Try again.",
    );
  }
  return { options };
}
