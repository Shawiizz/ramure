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
  status: Status;
  /** Newest first; their commits are in the history too. */
  stashes: Stash[];
  remotes: Remote[];
  /** What git stopped in the middle of, waiting for conflicts to be resolved. */
  operation: Operation | null;
}

export interface Remote {
  name: string;
  url: string;
}

export type Operation = 'rebase' | 'cherryPick' | 'revert' | 'merge';

/** How far a reset goes besides moving the branch (`ramure_git::actions::Reset`). */
export type Reset = 'soft' | 'mixed' | 'hard';

/** Work put aside (`ramure_git::Stash`). */
export interface Stash {
  /** `stash@{index}`, 0 the newest. */
  index: number;
  id: string;
  message: string;
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
  /** The message after its summary, empty when there is none. */
  body: string;
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
  /** A local branch on the same commit as its remote counterpart: one label for both. */
  synced: boolean;
}

export interface Status {
  upstream: Upstream | null;
  staged: Change[];
  unstaged: Change[];
  conflicted: Change[];
}

export interface Upstream {
  name: string;
  /** Commits to push. */
  ahead: number;
  /** Commits to pull. */
  behind: number;
}

export type ChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typeChanged'
  | 'untracked'
  | 'conflicted';

export interface Change {
  path: string;
  oldPath: string | null;
  kind: ChangeKind;
}

/** Where a change lies: in the working tree, in the index, in a commit or in a stash. */
export type Where =
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'commit'; id: string }
  | { kind: 'stash'; id: string };

export interface FileDiff {
  binary: boolean;
  hunks: Hunk[];
  truncated: boolean;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  kind: 'context' | 'added' | 'removed';
  old: number | null;
  new: number | null;
  text: string;
}
