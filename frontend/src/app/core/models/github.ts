/** The GitHub account signed in (`github::Account`). */
export interface GithubAccount {
  login: string;
  name: string | null;
  avatar_url: string;
}

/** The code to type on GitHub to sign in, and where (`github::DeviceCode`). */
export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

/** Where signing in stands (`github::Polled`). */
export type Polled =
  { state: 'pending' } | { state: 'slowDown' } | { state: 'done'; account: GithubAccount };

/** A repository of the user's on GitHub (`github::Repository`). */
export interface GithubRepository {
  full_name: string;
  description: string | null;
  private: boolean;
  clone_url: string;
  ssh_url: string;
  pushed_at: string | null;
}

/** An open pull request (`github::Pull`). */
export interface Pull {
  number: number;
  title: string;
  author: string;
  draft: boolean;
  url: string;
  /** The branch it brings, and the repository holding it: a fork's, maybe. */
  head: string;
  headRepository: string | null;
  /** The commit it brings last. */
  headId: string;
  base: string;
  /** The base branch's last commit. */
  baseId: string;
}

/** Where a check on a commit stands (`github::CheckState`). */
export type CheckState = 'success' | 'failure' | 'pending' | 'neutral';

/** A check run on a commit, or a status another service set (`github::Check`). */
export interface Check {
  name: string;
  state: CheckState;
  url: string | null;
}

/** Something said about a pull request (`github::Note`). */
export interface PullNote {
  kind: 'comment' | 'review' | 'code';
  author: string;
  avatar: string | null;
  body: string;
  time: string;
  /** A review's verdict. */
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | null;
  /** The file and line a comment on the code is about. */
  path: string | null;
  line: number | null;
  url: string | null;
}

/** A pull request read whole (`github::PullThread`). */
export interface PullThread extends Pull {
  body: string;
  avatar: string | null;
  state: 'open' | 'closed';
  merged: boolean;
  createdAt: string;
  notes: PullNote[];
}

/** A review's verdict, as GitHub's API names it. */
export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
