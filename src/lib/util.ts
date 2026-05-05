import { createId } from "@paralleldrive/cuid2";
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

export const IS_DEV = process.env.NODE_ENV === "development";
export const IS_MAINTENANCE_MODE = process.env.IS_MAINTENANCE_MODE === "true";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "title",
            "heading",
            "body-lg",
            "body",
            "label",
            "label-sm",
            "caption",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(prefix: string): string {
  return `${prefix ? `${prefix}-` : ""}${createId()}`;
}
