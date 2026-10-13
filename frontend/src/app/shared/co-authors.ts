/** Someone who wrote a commit along with its author. */
export interface CoAuthor {
  name: string;
  email: string;
}

const TRAILER = /^co-authored-by:\s*(.*?)\s*<([^>]*)>\s*$/i;

/**
 * A commit's description without its `Co-authored-by:` lines, and the people they name
 * (each once, in order).
 */
export function splitCoAuthors(body: string): { text: string; coAuthors: CoAuthor[] } {
  const coAuthors: CoAuthor[] = [];
  const kept: string[] = [];
  for (const line of body.split('\n')) {
    const found = TRAILER.exec(line.trim());
    if (!found) {
      kept.push(line);
      continue;
    }
    const [, name, email] = found;
    if (!coAuthors.some((c) => c.email.toLowerCase() === email.toLowerCase())) {
      coAuthors.push({ name: name || email, email });
    }
  }
  return { text: kept.join('\n').trim(), coAuthors };
}
