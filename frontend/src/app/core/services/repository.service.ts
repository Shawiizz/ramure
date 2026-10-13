import { Injectable, computed, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { Change, Commit, FileDiff, RefLabel, Snapshot, Stash, Where } from '../models/repository';
import { ProfilesService } from './profiles.service';

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

/** The commit or stash a diff is read in, null for the working tree. */
function sourceOf(where: Where): string | null {
  return where.kind === 'commit' || where.kind === 'stash' ? where.id : null;
}

/**
 * One tab's repository and what is done with it: the selection (a commit, or the working
 * tree), the diff on screen, the commands that change the repository.
 */
@Injectable()
export class RepositoryService {
  private readonly profiles = inject(ProfilesService);
  readonly snapshot = signal<Snapshot | null>(null);
  readonly loading = signal(false);
  /** The last failure, as git told it. */
  readonly error = signal<string | null>(null);
  /** Whether this repository's tab is in front. */
  readonly active = signal(false);
  /** A commit's id, or [`WIP`]. */
  readonly selectedId = signal<string | null>(null);
  readonly exchange = signal<Exchange | null>(null);
  readonly working = signal(false);
  readonly diff = signal<OpenDiff | null>(null);
  /** The files of the selected commit, once read. */
  readonly commitFiles = signal<{ id: string; files: Change[] } | null>(null);
  /** The commit message being written, kept while other commits are looked at. */
  readonly summary = signal('');
  readonly description = signal('');

  readonly selected = computed<Commit | null>(() => {
    const id = this.selectedId();
    return this.snapshot()?.commits.find((c) => c.id === id) ?? null;
  });

  /** The stashes by the id of the commit that holds each. */
  readonly stashes = computed(
    () => new Map((this.snapshot()?.stashes ?? []).map((stash) => [stash.id, stash])),
  );

  readonly selectedStash = computed<Stash | null>(
    () => this.stashes().get(this.selectedId() ?? '') ?? null,
  );

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

  /**
   * The names pointing at each commit, HEAD's branch first, then the local branches, the
   * remote ones and the tags. A local branch and its remote counterpart on the same commit
   * make one label.
   */
  readonly labels = computed(() => {
    const snapshot = this.snapshot();
    const labels = new Map<string, RefLabel[]>();
    if (!snapshot) return labels;
    const head = snapshot.head.kind === 'branch' ? snapshot.head.name : null;
    const add = (target: string, label: RefLabel) =>
      labels.set(target, [...(labels.get(target) ?? []), label]);
    const local = new Map(snapshot.branches.map((b) => [b.name, b.target]));
    const merged = new Set<string>();
    for (const b of snapshot.remoteBranches) {
      const name = b.name.slice(b.name.indexOf('/') + 1);
      if (local.get(name) === b.target) merged.add(name);
    }
    const sorted = [...snapshot.branches].sort((a, b) => +(b.name === head) - +(a.name === head));
    for (const b of sorted) {
      add(b.target, {
        name: b.name,
        kind: 'branch',
        head: b.name === head,
        synced: merged.has(b.name),
      });
    }
    for (const b of snapshot.remoteBranches) {
      const name = b.name.slice(b.name.indexOf('/') + 1);
      if (!(merged.has(name) && local.get(name) === b.target)) {
        add(b.target, { name: b.name, kind: 'remote', head: false, synced: false });
      }
    }
    for (const b of snapshot.tags) {
      add(b.target, { name: b.name, kind: 'tag', head: false, synced: false });
    }
    return labels;
  });

  /** Opens the repository holding `path`; false when it cannot. */
  async open(path: string): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const snapshot = await invoke<Snapshot>('open_repository', { path });
      this.diff.set(null);
      this.selectedId.set(null);
      this.apply(snapshot);
      return true;
    } catch (e) {
      this.error.set(String(e));
      return false;
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

  /** Commits what is staged with the message written, as the profile in use; then pushes it. */
  async commit(push: boolean): Promise<void> {
    const summary = this.summary().trim();
    const description = this.description().trim();
    const message = description ? `${summary}\n\n${description}` : summary;
    if (!(await this.change('commit', { message, identity: this.profiles.identity() }))) return;
    this.summary.set('');
    this.description.set('');
    if (!this.changes()) this.select(this.headId() ?? WIP);
    if (push) await this.exchangeWith('push');
  }

  /** Puts every change aside, under the summary being written when there is one. */
  async stash(): Promise<void> {
    const message = this.summary().trim() || null;
    if (await this.change('stash', { message, identity: this.profiles.identity() })) {
      if (message) this.summary.set('');
    }
  }

  /** Brings a stash's changes back; `pop` also takes it off the list. */
  restore(stash: Stash, pop: boolean) {
    return this.change(pop ? 'stash_pop' : 'stash_apply', { index: stash.index, id: stash.id });
  }

  dropStash(stash: Stash) {
    return this.change('stash_drop', { index: stash.index, id: stash.id });
  }

  /** A new branch at the selected commit (at HEAD from the working tree), switched to. */
  createBranch(name: string) {
    const id = this.selectedId();
    return this.change('create_branch', { name, start: id && id !== WIP ? id : null });
  }

  checkout(name: string, remote: boolean) {
    return this.change('checkout', { name, remote });
  }

  /** Switches to a branch beside its commit; a remote one gives a local one following it. */
  async switchTo(label: RefLabel): Promise<void> {
    if (label.kind !== 'tag' && !label.head)
      await this.checkout(label.name, label.kind === 'remote');
  }

  async exchangeWith(kind: Exchange): Promise<void> {
    this.exchange.set(kind);
    try {
      await this.change(kind, kind === 'pull' ? { identity: this.profiles.identity() } : {});
    } finally {
      this.exchange.set(null);
    }
  }

  /** Opens a file's diff, or closes it when it is the one on screen. */
  toggleDiff(change: Change, where: Where) {
    if (this.isOpen(change, where)) this.diff.set(null);
    else this.showDiff(change, where);
  }

  isOpen(change: Change, where: Where): boolean {
    const open = this.diff();
    return (
      !!open &&
      open.change.path === change.path &&
      open.where.kind === where.kind &&
      sourceOf(open.where) === sourceOf(where)
    );
  }

  async showDiff(change: Change, where: Where): Promise<void> {
    const path = this.snapshot()?.path;
    if (!path) return;
    // the same file read again keeps its lines on screen meanwhile
    const before = this.diff();
    const same = before && this.isOpen(change, where);
    this.diff.set({ change, where, diff: same ? before.diff : null });
    try {
      const diff = await invoke<FileDiff>('file_diff', { path, change, side: where });
      if (this.diff()?.change === change) this.diff.set({ change, where, diff });
    } catch (e) {
      this.error.set(String(e));
      this.diff.set(null);
    }
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
    // one once it is all staged (unstaged), or closed with its change gone; one of a commit
    // or a stash goes with it
    const diff = this.diff();
    const source = diff && sourceOf(diff.where);
    if (source) {
      if (!snapshot.commits.some((c) => c.id === source)) this.diff.set(null);
    } else if (diff) {
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
      const command = this.stashes().has(id) ? 'stash_files' : 'commit_files';
      const files = await invoke<Change[]>(command, { path, id });
      if (this.selectedId() === id) this.commitFiles.set({ id, files });
    } catch (e) {
      this.error.set(String(e));
    }
  }
}
