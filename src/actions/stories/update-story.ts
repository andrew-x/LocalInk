"use server";

import { publicActionClient } from "@/lib/action";
import { updateStoryFields } from "@/lib/server/story-details";

import {
  updateStoryActionSchema,
  updateStoryBackstoryFormSchema,
  updateStoryFormSchema,
} from "./_schemas";

export const updateStory = publicActionClient
  .metadata({ action: "update-story" })
  .inputSchema(updateStoryActionSchema)
  .action(({ parsedInput }) => updateStoryFields(parsedInput));

export const updateStoryDetails = publicActionClient
  .metadata({ action: "update-story-details" })
  .inputSchema(updateStoryFormSchema)
  .action(({ parsedInput }) => updateStoryFields(parsedInput));

export const updateStoryBackstory = publicActionClient
  .metadata({ action: "update-story-backstory" })
  .inputSchema(updateStoryBackstoryFormSchema)
  .action(({ parsedInput }) =>
    updateStoryFields({ id: parsedInput.id, backstory: parsedInput.backstory }),
  );
