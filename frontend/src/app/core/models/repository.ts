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

/**
 * Which names the history is drawn from, by `kind:name` (`branch:main`,
 * `remote:origin/main`, `tag:v1.0`): all but the hidden ones, or only the soloed ones.
 */
export interface View {
  hidden: string[];
  solo: string[];
}

export const ALL_SHOWN: View = { hidden: [], solo: [] };

/** Where HEAD and every branch and tag are (`ramure_git::RefState`), for undo and redo. */
export interface RefState {
  head: { kind: 'branch'; name: string } | { kind: 'detached'; id: string };
  refs: Record<string, string>;
}

/** How the checked-out branch moves back: its files kept as they are, or following. */
export type Move = 'soft' | 'keep';

/** A commit an interactive rebase replays (`ramure_git::actions::Planned`). */
export interface Planned {
  id: string;
  summary: string;
  message: string;
}

export type StepAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

export interface Step {
  id: string;
  action: StepAction;
  message: string | null;
}

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

/** A commit's signature, unchecked (`ramure_git::Signature`). */
export interface Signature {
  kind: 'ssh' | 'gpg';
}

/** A signature checked against the keys git trusts (`ramure_git::Verification`). */
export interface Verification {
  verified: boolean;
  signer: string;
}

/** What a commit becomes, rewritten (`ramure_git::actions::Rewrite`). */
export interface Rewrite {
  message: string;
  authorName: string;
  authorEmail: string;
  /** Seconds since 1970, and the offset from UTC it is told in, in minutes. */
  time: number;
  offset: number;
  /** The commit date set to the same as well. */
  commitDateToo: boolean;
}

/** A commit that changed a file, and how (`ramure_git::FileCommit`). */
export interface FileCommit {
  id: string;
  summary: string;
  author: string;
  email: string;
  time: number;
  /** The file as this commit changed it: a renamed one under the name it had then. */
  change: Change;
}

/** A file with the commit of each line (`ramure_git::Blame`). */
export interface Blame {
  text: string;
  /** The commit of each line, in order; zeros for one not committed yet. */
  lines: string[];
  commits: Record<string, { author: string; email: string; time: number; summary: string }>;
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

/**
 * Where a change lies: in the working tree, in the index, in a commit, in a stash, or
 * between two commits compared.
 */
export type Where =
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'commit'; id: string }
  | { kind: 'stash'; id: string }
  | { kind: 'compare'; from: string; to: string };

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

/** A file as it was, kept to be put back: its bytes' blob, its index entries. */
export interface SavedFile {
  path: string;
  blob: string | null;
  index: string[];
}

/** What a pull request changes, from where it left its base to its last commit. */
export interface PullFiles {
  from: string;
  to: string;
  files: Change[];
}

/** A move of HEAD: the commit it went to, what moved it, when. */
export interface RefLogEntry {
  id: string;
  action: string;
  message: string;
  time: number;
}

/** One side of a conflict: the branch checked out's, or what was brought in. */
export type Version = 'current' | 'incoming';

/** Which sides of a conflict still have the file. */
export interface Sides {
  current: boolean;
  incoming: boolean;
}

/**
 * What becomes of a hunk, or of lines picked in it: staged, unstaged, thrown away; or, of a
 * commit's, taken back out of the working tree.
 */
export type Part = 'stage' | 'unstage' | 'discard' | 'revert';

/** git's tree with nothing in it: what the first commit's changes start from. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** A changed line: a removed one by its old number, an added one by its new. */
export interface Picked {
  old: number | null;
  new: number | null;
}
