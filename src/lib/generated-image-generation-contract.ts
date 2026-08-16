import type { z } from "zod";

import { generateImageActionSchema } from "@/actions/generated-images/_schemas";
import type { ActionErrorCode } from "@/lib/action-error";

/**
 * Image generation runs through a Route Handler rather than a Server Action:
 * Next dispatches Server Actions one at a time per client, so concurrent
 * generations would silently queue. See docs/backend-actions.md.
 */
export const GENERATE_IMAGE_ROUTE_PATH = "/api/generated-images/generate";

export const generateImageRequestSchema = generateImageActionSchema;

export type GenerateImageRequest = z.infer<typeof generateImageRequestSchema>;

export type GenerateImageRouteError = {
  code: ActionErrorCode;
  message: string;
};

/**
 * Browsers cap concurrent connections per origin at roughly six, and every
 * in-flight generation holds one for its whole life, which runs to minutes for
 * a large image. Three leaves headroom for thumbnail content requests, route
 * navigations, and the prompt-enhancement Server Action.
 */
export const MAX_CONCURRENT_IMAGE_GENERATIONS = 3;
