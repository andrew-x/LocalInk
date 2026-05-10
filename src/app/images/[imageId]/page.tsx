import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getGeneratedImage } from "@/actions/generated-images/get-generated-image";
import { GeneratedImagePreview } from "@/components/generated-images/generated-image-preview";

type GeneratedImagePageProps = {
  params: Promise<{
    imageId: string;
  }>;
  searchParams: Promise<{
    from?: string;
  }>;
};

export default async function GeneratedImagePage({
  params,
  searchParams,
}: GeneratedImagePageProps) {
  await connection();

  const [{ imageId }, { from }] = await Promise.all([params, searchParams]);
  const image = await getGeneratedImage(imageId);

  if (!image) {
    notFound();
  }

  const openedFromGenerator = from === "generate";

  return (
    <GeneratedImagePreview
      backHref={openedFromGenerator ? "/images/generate" : "/images"}
      backLabel={openedFromGenerator ? "Generator" : "Gallery"}
      image={image}
    />
  );
}
