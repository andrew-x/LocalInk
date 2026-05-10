import { connection } from "next/server";

import type { GenerateImageFormValues } from "@/actions/generated-images/_schemas";
import type { GeneratedImageListItem } from "@/actions/generated-images/_types";
import { getGeneratedImage } from "@/actions/generated-images/get-generated-image";
import { getGeneratedImageDefaults } from "@/actions/generated-images/get-generated-image-defaults";
import { getLatestGeneratedImage } from "@/actions/generated-images/get-latest-generated-image";
import { AppHeader } from "@/components/app/app-header";
import { GenerateImageWorkspace } from "@/components/generated-images/generate-image-workspace";
import {
  normalizeGeneratedImageAspectRatio,
  normalizeGeneratedImageModel,
  normalizeGeneratedImageSize,
} from "@/lib/generated-images";

type GenerateImagesPageProps = {
  searchParams: Promise<{
    source?: string;
  }>;
};

export default async function GenerateImagesPage({
  searchParams,
}: GenerateImagesPageProps) {
  await connection();

  const [{ source }, defaults] = await Promise.all([
    searchParams,
    getGeneratedImageDefaults(),
  ]);
  const prefillImage = source
    ? await getGeneratedImage(source)
    : await getLatestGeneratedImage();
  const defaultValues: GenerateImageFormValues = prefillImage
    ? toDefaultValues(prefillImage)
    : {
        aspectRatio: defaults.aspectRatio,
        imageSize: defaults.imageSize,
        model: defaults.model,
        prompt: "",
        stylePreset: defaults.stylePreset,
        stylePrompt: defaults.stylePrompt,
      };

  return (
    <main className="h-dvh overflow-hidden bg-background text-foreground">
      <div className="flex h-dvh min-h-0 w-full flex-col px-page py-4 md:py-5">
        <AppHeader />
        <GenerateImageWorkspace
          defaultValues={defaultValues}
          initialImage={prefillImage}
        />
      </div>
    </main>
  );
}

function toDefaultValues(
  image: GeneratedImageListItem,
): GenerateImageFormValues {
  return {
    aspectRatio: normalizeGeneratedImageAspectRatio(image.aspectRatio),
    imageSize: normalizeGeneratedImageSize(image.imageSize),
    model: normalizeGeneratedImageModel(image.model),
    prompt: image.prompt,
    stylePreset: image.stylePreset,
    stylePrompt: image.stylePrompt,
  };
}
