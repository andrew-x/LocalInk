import "server-only";

import { createHash } from "node:crypto";

export { EMPTY_CHAPTER_CONTENT_HASH } from "../chapter-content-hash";

export function hashChapterContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
