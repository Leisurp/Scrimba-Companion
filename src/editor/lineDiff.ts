/**
 * Minimal single-range diff used by the native text-input bridge. The native TextInput
 * mirrors one editor line; each change is reduced to "replace [start, end) of the old
 * text with `text`", which maps 1:1 to a Monaco edit and keeps undo granular.
 */
export interface LineEdit {
  /** 0-based offsets into the previous text. */
  start: number;
  end: number;
  text: string;
}

export function computeLineEdit(prev: string, next: string, cursorHint?: number): LineEdit | null {
  if (prev === next) return null;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--;
    endNext--;
  }
  // Ambiguous repeated characters ("aa" -> "aaa"): if the native cursor tells us where the
  // insertion happened, prefer an edit that ends at the cursor so Monaco's cursor matches.
  if (cursorHint !== undefined && endNext - start > 0 && endPrev === start) {
    const insertedLen = next.length - prev.length;
    const candidateStart = cursorHint - insertedLen;
    if (
      insertedLen > 0 &&
      candidateStart >= 0 &&
      candidateStart <= prev.length &&
      prev.slice(0, candidateStart) + next.slice(candidateStart, cursorHint) + prev.slice(candidateStart) === next
    ) {
      return { start: candidateStart, end: candidateStart, text: next.slice(candidateStart, cursorHint) };
    }
  }
  return { start, end: endPrev, text: next.slice(start, endNext) };
}

export function applyLineEdit(prev: string, edit: LineEdit): string {
  return prev.slice(0, edit.start) + edit.text + prev.slice(edit.end);
}

/** Native 0-based offset → Monaco 1-based column. */
export const toColumn = (offset: number) => offset + 1;
/** Monaco 1-based column → native 0-based offset. */
export const toOffset = (column: number) => Math.max(0, column - 1);
