import { connection } from "next/server";

import { getGeneratedImages } from "@/actions/generated-images/get-generated-images";
import { AppHeader } from "@/components/app/app-header";
import { GeneratedImageGallery } from "@/components/generated-images/generated-image-gallery";

export default async function ImagesPage() {
  await connection();

  const images = await getGeneratedImages();

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="flex min-h-dvh w-full flex-col px-page py-4 md:py-5">
        <AppHeader />
        <GeneratedImageGallery images={images} />
      </div>
    </main>
  );
}
