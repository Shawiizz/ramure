/** How well a text matches what was typed, and where its letters were found. */
export interface Match {
  score: number;
  /** The places in the text of the letters typed, in order. */
  at: number[];
}

/**
 * Whether the letters of `query` are found in `text` in order, ignoring case and spaces;
 * the match scores higher for letters that follow each other, that start a word, and for a
 * shorter text. Null when they are not all there.
 */
export function fuzzy(query: string, text: string): Match | null {
  const wanted = query.toLowerCase().replace(/\s+/g, '');
  if (!wanted) return { score: 0, at: [] };
  const lower = text.toLowerCase();
  const at: number[] = [];
  let score = 0;
  let from = 0;
  for (const letter of wanted) {
    const found = bestPlace(lower, text, letter, from, at[at.length - 1]);
    if (found < 0) return null;
    if (found === at[at.length - 1] + 1) score += 3;
    if (startsWord(text, found)) score += 2;
    at.push(found);
    from = found + 1;
  }
  score -= text.length / 100;
  return { score, at };
}

/** The letter's next place: right after the last one, else at a word's start, else the first. */
function bestPlace(lower: string, text: string, letter: string, from: number, last?: number) {
  const first = lower.indexOf(letter, from);
  if (first < 0 || (last !== undefined && first === last + 1)) return first;
  for (let i = first; i >= 0; i = lower.indexOf(letter, i + 1)) {
    if (startsWord(text, i)) return i;
  }
  return first;
}

function startsWord(text: string, i: number): boolean {
  if (i === 0) return true;
  const before = text[i - 1];
  const here = text[i];
  return (
    /[\s/\\._-]/.test(before) || (before === before.toLowerCase() && here !== here.toLowerCase())
  );
}
