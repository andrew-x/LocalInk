/** Strips `*` and `_` emphasis markers only; all other markdown is kept. */
export function markdownToPlainText(md: string): string {
  return md.replace(/[*_]/g, "");
}

export function countWords(md: string): number {
  const text = markdownToPlainText(md).trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?…]["'”’)\]]*)\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** 32-bit FNV-1a, lowercase hex. Works anywhere, with no Node crypto. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeSentence(sentence: string): string {
  return sentence.toLowerCase().replace(/\s+/g, " ").trim();
}

export function sentenceHashes(md: string): string[] {
  return splitSentences(markdownToPlainText(md))
    .map(normalizeSentence)
    .filter((sentence) => sentence.length > 0)
    .map(hashText);
}

/**
 * Whether the text moved enough from the hashes of its last read-back to be
 * worth another one. Changed sentences count as the larger of distinct
 * sentences added and removed, so editing one sentence in place counts once.
 * Meaningful at two or more, or at a quarter of the longer version.
 */
export function isMeaningfulChange(
  previousHashes: string[],
  md: string,
): boolean {
  const current = sentenceHashes(md);
  if (previousHashes.length === 0) return current.length > 0;

  const previousSet = new Set(previousHashes);
  const currentSet = new Set(current);
  let added = 0;
  for (const hash of currentSet) if (!previousSet.has(hash)) added++;
  let removed = 0;
  for (const hash of previousSet) if (!currentSet.has(hash)) removed++;
  const changed = Math.max(added, removed);
  if (changed === 0) return false;
  return (
    changed >= 2 ||
    changed >= 0.25 * Math.max(previousHashes.length, current.length)
  );
}

export function tailParagraphs(md: string, count: number): string {
  if (count <= 0) return "";
  const paragraphs = md
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  return paragraphs.slice(-count).join("\n\n");
}
