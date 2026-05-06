import { z } from "zod";

export const settingsFormSchema = z.object({
  systemInstructions: z
    .string()
    .max(8000, "System instructions must be 8000 characters or fewer."),
});

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;
