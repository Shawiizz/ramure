import { DiffLine, Hunk } from '../../core/models/repository';

/** A piece of a line's text, marked when it is what changed in the line. */
export interface Part {
  text: string;
  changed: boolean;
}

export interface MarkedLine extends DiffLine {
  parts: Part[];
}

/** Below this share of text in common, a line changed all through: nothing is marked. */
const KEPT_ENOUGH = 0.25;

/**
 * The hunk's lines with what changed inside them marked: each removed line of a block is
 * paired with the added line in the same place in the block after it, and the text
 * between their common start and common end is marked in both.
 */
export function markChanges(hunk: Hunk): MarkedLine[] {
  const lines: MarkedLine[] = hunk.lines.map((line) => ({
    ...line,
    parts: [{ text: line.text, changed: false }],
  }));
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== 'removed') {
      i++;
      continue;
    }
    let added = i;
    while (added < lines.length && lines[added].kind === 'removed') added++;
    let end = added;
    while (end < lines.length && lines[end].kind === 'added') end++;
    for (let k = 0; k < Math.min(added - i, end - added); k++) {
      mark(lines[i + k], lines[added + k]);
    }
    i = end;
  }
  return lines;
}

function mark(before: MarkedLine, after: MarkedLine) {
  const a = before.text;
  const b = after.text;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++;
  }
  // whole words: a change inside one marks all of it
  while (start > 0 && isWord(a[start - 1]) && (isWord(a[start]) || isWord(b[start]))) start--;
  while (
    end > 0 &&
    isWord(a[a.length - end]) &&
    (isWord(a[a.length - 1 - end]) || isWord(b[b.length - 1 - end]))
  ) {
    end--;
  }
  if (start + end < Math.max(a.length, b.length) * KEPT_ENOUGH) return;
  before.parts = split(a, start, a.length - end);
  after.parts = split(b, start, b.length - end);
}

function split(text: string, from: number, to: number): Part[] {
  return [
    { text: text.slice(0, from), changed: false },
    { text: text.slice(from, to), changed: true },
    { text: text.slice(to), changed: false },
  ].filter((part) => part.text);
}

function isWord(char: string | undefined): boolean {
  return !!char && /\w/.test(char);
}
