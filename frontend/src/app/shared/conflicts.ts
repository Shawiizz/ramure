/** A conflict git left in a file: the lines of its markers, numbered from 1, and its sides' names. */
export interface Conflict {
  /** `<<<<<<< current` */
  start: number;
  /** `||||||| base`, when git wrote the common version too (diff3). */
  base: number | null;
  /** `=======` */
  middle: number;
  /** `>>>>>>> incoming` */
  end: number;
  current: string;
  incoming: string;
}

/** What a conflict is resolved with. */
export type Choice = 'current' | 'incoming' | 'both';

/** The conflicts in `lines`; markers that do not make a whole one are left alone. */
export function findConflicts(lines: string[]): Conflict[] {
  const conflicts: Conflict[] = [];
  let open: Partial<Conflict> | null = null;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (marker(line, '<')) {
      open = { start: n, base: null, current: label(line) };
    } else if (!open) {
      return;
    } else if (marker(line, '|') && open.middle === undefined) {
      open.base = n;
    } else if (line.trimEnd() === '=======' && open.middle === undefined) {
      open.middle = n;
    } else if (marker(line, '>') && open.middle !== undefined) {
      conflicts.push({ ...open, end: n, incoming: label(line) } as Conflict);
      open = null;
    }
  });
  return conflicts;
}

/** The lines a conflict is resolved into. */
export function resolution(lines: string[], conflict: Conflict, choice: Choice): string[] {
  const current = lines.slice(conflict.start, (conflict.base ?? conflict.middle) - 1);
  const incoming = lines.slice(conflict.middle, conflict.end - 1);
  if (choice === 'current') return current;
  return choice === 'incoming' ? incoming : [...current, ...incoming];
}

function marker(line: string, sign: string): boolean {
  return line.startsWith(sign.repeat(7)) && (line.length === 7 || line[7] === ' ');
}

function label(line: string): string {
  return line.slice(8).trim();
}
