/** A repository as the backend reads it (`ramure_git::Snapshot`). */
export interface Snapshot {
  name: string;
  path: string;
  head: Head;
  branches: Branch[];
  remoteBranches: Branch[];
  tags: Branch[];
  commits: Commit[];
  graph: GraphRow[];
}

export type Head =
  | { kind: 'branch'; name: string }
  | { kind: 'detached'; id: string }
  | { kind: 'unborn'; name: string };

/** A branch or a tag and the commit it points at. */
export interface Branch {
  name: string;
  target: string;
}

export interface Commit {
  id: string;
  parents: string[];
  summary: string;
  author: string;
  email: string;
  /** Seconds since 1970. */
  time: number;
}

/** What crosses one row of the graph: see `ramure_git::graph`. */
export interface GraphRow {
  lane: number;
  through: number[];
  into: number[];
  out: number[];
  width: number;
}

/** A name pointing at a commit, as shown beside it. */
export interface RefLabel {
  name: string;
  kind: 'branch' | 'remote' | 'tag';
  head: boolean;
}
