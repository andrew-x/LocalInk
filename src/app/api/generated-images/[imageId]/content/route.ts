import { getGeneratedImageDownloadFilename } from "@/lib/generated-images";
import { openGeneratedImageFileStream } from "@/lib/server/generated-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeneratedImageContentRouteContext = {
  params: Promise<{
    imageId: string;
  }>;
};

export async function GET(
  request: Request,
  { params }: GeneratedImageContentRouteContext,
): Promise<Response> {
  const { imageId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const result = await openGeneratedImageFileStream(imageId).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    },
  );

  if (!result) {
    return new Response(null, { status: 404 });
  }

  const headers = new Headers({
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Length": String(result.image.fileSize),
    "Content-Type": result.image.mimeType,
  });

  if (searchParams.get("download") === "1") {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${getGeneratedImageDownloadFilename(result.image)}"`,
    );
  }

  return new Response(result.stream, {
    headers,
  });
}
