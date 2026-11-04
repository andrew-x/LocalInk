export type WordDiffSegment = {
  type: "same" | "add" | "del";
  text: string;
};

/** Words with their trailing whitespace, so joined segments rebuild the text. */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

const same = (a: string, b: string) => a.trim() === b.trim();
/** Above this many DP cells the middle is shown as one removal and one addition. */
const MAX_CELLS = 6_000_000;

function pushSegment(
  out: WordDiffSegment[],
  type: WordDiffSegment["type"],
  text: string,
) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === type) last.text += text;
  else out.push({ type, text });
}

/**
 * A word-level diff by longest common subsequence, with the shared prefix and
 * suffix trimmed first. Implemented locally to avoid a dependency.
 */
export function wordDiff(before: string, after: string): WordDiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);
  let start = 0;
  while (start < a.length && start < b.length && same(a[start], b[start])) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && same(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }

  const out: WordDiffSegment[] = [];
  pushSegment(out, "same", b.slice(0, start).join(""));

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const rows = midA.length + 1;
  const cols = midB.length + 1;
  if (midA.length === 0 || midB.length === 0 || rows * cols > MAX_CELLS) {
    pushSegment(out, "del", midA.join(""));
    pushSegment(out, "add", midB.join(""));
  } else {
    // lcs[i][j]: common words of midA[i..] and midB[j..].
    const lcs = new Uint32Array(rows * cols);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        lcs[i * cols + j] = same(midA[i], midB[j])
          ? lcs[(i + 1) * cols + j + 1] + 1
          : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (same(midA[i], midB[j])) {
        pushSegment(out, "same", midB[j]);
        i++;
        j++;
      } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) {
        pushSegment(out, "del", midA[i++]);
      } else {
        pushSegment(out, "add", midB[j++]);
      }
    }
    while (i < midA.length) pushSegment(out, "del", midA[i++]);
    while (j < midB.length) pushSegment(out, "add", midB[j++]);
  }

  pushSegment(out, "same", b.slice(endB).join(""));
  return out;
}
