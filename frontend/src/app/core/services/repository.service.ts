import { Injectable, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '../i18n/i18n';
import { Change, Commit, FileDiff, RefLabel, Snapshot, Where } from '../models/repository';

const RECENT_KEY = 'ramure.recent';
const RECENT_MAX = 8;

/** The selection standing for the working tree's changes, above the history. */
export const WIP = 'wip';

/** A file's diff open in the middle of the window. */
export interface OpenDiff {
  change: Change;
  where: Where;
  diff: FileDiff | null;
}

/** An exchange with a remote, under way. */
export type Exchange = 'fetch' | 'pull' | 'push';

/**
 * The open repository and what is done with it: the selection (a commit, or the working
 * tree), the diff on screen, the commands that change the repository.
 */
@Injectable({ providedIn: 'root' })
export class RepositoryService {
  readonly snapshot = signal<Snapshot | null>(null);
  readonly loading = signal(false);
  /** The last failure, as git told it. */
  readonly error = signal<string | null>(null);
  /** A commit's id, or [`WIP`]. */
  readonly selectedId = signal<string | null>(null);
  readonly exchange = signal<Exchange | null>(null);
  readonly working = signal(false);
  readonly diff = signal<OpenDiff | null>(null);
  readonly recent = signal<string[]>(readRecent());
  /** The files of the selected commit, once read. */
  readonly commitFiles = signal<{ id: string; files: Change[] } | null>(null);

  readonly selected = computed<Commit | null>(() => {
    const id = this.selectedId();
    return this.snapshot()?.commits.find((c) => c.id === id) ?? null;
  });

  readonly changes = computed(() => {
    const status = this.snapshot()?.status;
    return status ? status.staged.length + status.unstaged.length + status.conflicted.length : 0;
  });

  /** The commit HEAD is on. */
  readonly headId = computed(() => {
    const snapshot = this.snapshot();
    if (!snapshot) return null;
    const head = snapshot.head;
    if (head.kind === 'detached') return head.id;
    return snapshot.branches.find((b) => b.name === head.name)?.target ?? null;
  });

  /** The branch and tag names pointing at each commit. */
  readonly labels = computed(() => {
    const snapshot = this.snapshot();
    const labels = new Map<string, RefLabel[]>();
    if (!snapshot) return labels;
    const head = snapshot.head.kind === 'branch' ? snapshot.head.name : null;
    const add = (target: string, label: RefLabel) =>
      labels.set(target, [...(labels.get(target) ?? []), label]);
    for (const b of snapshot.branches)
      add(b.target, { name: b.name, kind: 'branch', head: b.name === head });
    for (const b of snapshot.remoteBranches)
      add(b.target, { name: b.name, kind: 'remote', head: false });
    for (const b of snapshot.tags) add(b.target, { name: b.name, kind: 'tag', head: false });
    return labels;
  });

  /** Asks for a folder and opens the repository holding it. */
  async pick(): Promise<void> {
    const path = await open({ directory: true, title: t('Open a repository') });
    if (typeof path === 'string') await this.open(path);
  }

  async open(path: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const snapshot = await invoke<Snapshot>('open_repository', { path });
      this.diff.set(null);
      this.selectedId.set(null);
      this.apply(snapshot);
      this.remember(snapshot.path);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Reads the repository again (it may have changed outside). */
  async refresh(): Promise<void> {
    const path = this.snapshot()?.path;
    if (!path || this.working()) return;
    try {
      this.apply(await invoke<Snapshot>('open_repository', { path }));
    } catch (e) {
      this.error.set(String(e));
    }
  }

  close() {
    this.snapshot.set(null);
    this.selectedId.set(null);
    this.diff.set(null);
  }

  select(id: string) {
    this.selectedId.set(id);
    if (id !== WIP) this.loadCommitFiles(id);
  }

  stage(files: string[]) {
    return this.change('stage', { files });
  }

  unstage(files: string[]) {
    return this.change('unstage', { files });
  }

  /** Commits what is staged; true when it is done. */
  async commit(message: string): Promise<boolean> {
    if (!(await this.change('commit', { message }))) return false;
    if (!this.changes()) this.select(this.headId() ?? WIP);
    return true;
  }

  /** A new branch at the selected commit (at HEAD from the working tree), switched to. */
  createBranch(name: string) {
    const id = this.selectedId();
    return this.change('create_branch', { name, start: id && id !== WIP ? id : null });
  }

  checkout(name: string, remote: boolean) {
    return this.change('checkout', { name, remote });
  }

  async exchangeWith(kind: Exchange): Promise<void> {
    this.exchange.set(kind);
    try {
      await this.change(kind, {});
    } finally {
      this.exchange.set(null);
    }
  }

  async showDiff(change: Change, where: Where): Promise<void> {
    const path = this.snapshot()?.path;
    if (!path) return;
    // the same file read again keeps its lines on screen meanwhile
    const before = this.diff();
    const same = before?.change.path === change.path && before.where.kind === where.kind;
    this.diff.set({ change, where, diff: same ? before.diff : null });
    try {
      const diff = await invoke<FileDiff>('file_diff', { path, change, side: where });
      if (this.diff()?.change === change) this.diff.set({ change, where, diff });
    } catch (e) {
      this.error.set(String(e));
      this.diff.set(null);
    }
  }

  forget(path: string) {
    this.saveRecent(this.recent().filter((p) => p !== path));
  }

  /** Runs a command that changes the repository and takes its new state; false on failure. */
  private async change(command: string, args: Record<string, unknown>): Promise<boolean> {
    const path = this.snapshot()?.path;
    if (!path) return false;
    this.working.set(true);
    this.error.set(null);
    try {
      this.apply(await invoke<Snapshot>(command, { path, ...args }));
      return true;
    } catch (e) {
      this.error.set(String(e));
      return false;
    } finally {
      this.working.set(false);
    }
  }

  /** Takes a new state, keeping the selection where it still makes sense. */
  private apply(snapshot: Snapshot) {
    this.snapshot.set(snapshot);
    const selected = this.selectedId();
    const stillThere =
      selected === WIP ? this.changes() > 0 : snapshot.commits.some((c) => c.id === selected);
    if (!stillThere) {
      const first = this.changes() > 0 ? WIP : (this.headId() ?? snapshot.commits[0]?.id);
      if (first) this.select(first);
      else this.selectedId.set(null);
    }
    // a diff of the working tree follows its file: read again on its side, or on the other
    // one once it is all staged (unstaged), or closed with its change gone
    const diff = this.diff();
    if (diff && diff.where.kind !== 'commit') {
      const status = snapshot.status;
      const unstaged = [...status.unstaged, ...status.conflicted];
      const staged = diff.where.kind === 'staged';
      const find = (list: Change[]) => list.find((c) => c.path === diff.change.path);
      const here = find(staged ? status.staged : unstaged);
      const there = find(staged ? unstaged : status.staged);
      if (here) this.showDiff(here, diff.where);
      else if (there) this.showDiff(there, { kind: staged ? 'unstaged' : 'staged' });
      else this.diff.set(null);
    }
  }

  private async loadCommitFiles(id: string) {
    const path = this.snapshot()?.path;
    if (!path || this.commitFiles()?.id === id) return;
    this.commitFiles.set(null);
    try {
      const files = await invoke<Change[]>('commit_files', { path, id });
      if (this.selectedId() === id) this.commitFiles.set({ id, files });
    } catch (e) {
      this.error.set(String(e));
    }
  }

  private remember(path: string) {
    this.saveRecent([path, ...this.recent().filter((p) => p !== path)].slice(0, RECENT_MAX));
  }

  private saveRecent(paths: string[]) {
    this.recent.set(paths);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(paths));
    } catch {
      // storage unavailable: the list lasts for this run
    }
  }
}

function readRecent(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}
