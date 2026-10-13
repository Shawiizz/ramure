import { Commit } from '../core/models/repository';

/** Whether `ancestor` is `from` or one of its ancestors, among the commits read. */
export function reaches(
  commits: Commit[],
  from: string | null | undefined,
  ancestor: string,
): boolean {
  if (!from) return false;
  const parents = new Map(commits.map((c) => [c.id, c.parents]));
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const id = queue.pop()!;
    if (id === ancestor) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(parents.get(id) ?? []));
  }
  return false;
}
