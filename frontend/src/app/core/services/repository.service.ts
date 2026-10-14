import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../i18n/i18n';
import {
  ALL_SHOWN,
  Change,
  Commit,
  FileDiff,
  Move,
  Part,
  Picked,
  Planned,
  RefLabel,
  RefState,
  Reset,
  Rewrite,
  Signature,
  Snapshot,
  Stash,
  Step,
  Version,
  View,
  Where,
} from '../models/repository';
import { githubRepository } from '../../shared/web-url';
import { Pull } from '../models/github';
import { GithubService } from './github.service';
import { PreferencesService } from './preferences.service';
import { ProfilesService } from './profiles.service';
import { SettingsService } from './settings.service';

/** The selection standing for the working tree's changes, above the history. */
export const WIP = 'wip';

/** A file's diff open in the middle of the window. */
export interface OpenDiff {
  change: Change;
  where: Where;
  diff: FileDiff | null;
}

/** A file looked at on its own in the middle of the window: its history, its blame (as
 * the working tree has it, or as the commit `at` had it), or itself, edited. */
export interface FilePanel {
  mode: 'history' | 'blame' | 'edit' | 'resolve';
  path: string;
  at?: string;
}

/** A commit, by the name it was picked by. */
export interface Named {
  id: string;
  name: string;
}

/** Two commits compared: the files that differ from the one to the other. */
export interface Comparison {
  from: Named;
  to: Named;
  files: Change[] | null;
}

/** An exchange with a remote, under way. */
export type Exchange = 'fetch' | 'pull' | 'push';

/** An action done, and how to take it back: where the names were before it and after. */
export interface Undoable {
  /** What was done, to complete "Undo …" and "Redo …". */
  what: string;
  before: RefState;
  after: RefState;
  how: Move;
}

/** Actions undone at most, back from the last. */
const UNDO_DEPTH = 50;

/** The commit or stash a diff is read in, null for the working tree. */
function sourceOf(where: Where): string | null {
  if (where.kind === 'compare') return `${where.from}..${where.to}`;
  return where.kind === 'commit' || where.kind === 'stash' ? where.id : null;
}

/**
 * One tab's repository and what is done with it: the selection (a commit, or the working
 * tree), the diff on screen, the commands that change the repository.
 */
@Injectable()
export class RepositoryService {
  private readonly profiles = inject(ProfilesService);
  private readonly preferences = inject(PreferencesService);
  private readonly store = inject(SettingsService);
  private readonly hub = inject(GithubService);
  /** What can be undone, the last last; what was undone, to redo. */
  readonly undoable = signal<Undoable[]>([]);
  readonly redoable = signal<Undoable[]>([]);
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
  /** The command at work (`checkout`, `rebase`…), for the loader to name it. */
  readonly activity = signal<string | null>(null);
  readonly diff = signal<OpenDiff | null>(null);
  readonly filePanel = signal<FilePanel | null>(null);
  readonly comparison = signal<Comparison | null>(null);
  /** A terminal runs in the repository's folder; it may be out of sight meanwhile. */
  readonly terminalOpen = signal(false);
  /** Older commits are being read, or none is left to read. */
  private reading = false;
  private readAll = false;
  readonly terminalShown = signal(false);
  /** The selected commit's signature, once read; null for one unsigned. */
  readonly signature = signal<{ id: string; signature: Signature | null } | null>(null);
  /** The files of the selected commit, once read. */
  readonly commitFiles = signal<{ id: string; files: Change[] } | null>(null);
  /** The commit message being written, kept while other commits are looked at. */
  readonly summary = signal('');
  readonly description = signal('');
  /** The next commit goes into the last one instead. */
  readonly amending = signal(false);

  readonly selected = computed<Commit | null>(() => {
    const id = this.selectedId();
    return this.snapshot()?.commits.find((c) => c.id === id) ?? null;
  });

  /** The names hidden or soloed in this repository's history. */
  readonly view = computed<View>(() => {
    const path = this.snapshot()?.path;
    return (path && this.store.settings().views[path]) || ALL_SHOWN;
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
    // a name hidden from the history leaves the graph too
    const hidden = new Set(this.view().hidden);
    const add = (target: string, label: RefLabel) => {
      const key = `${label.kind === 'branch' ? 'branch' : label.kind}:${label.name}`;
      if (!hidden.has(key)) labels.set(target, [...(labels.get(target) ?? []), label]);
    };
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

  /** The repository on GitHub its remote (`origin`, else the first) is: `owner/name`. */
  readonly github = computed(() => {
    const remotes = this.snapshot()?.remotes ?? [];
    const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0];
    const repository = remote && githubRepository(remote.url);
    return repository ? { remote: remote.name, repository } : null;
  });
  /** Its open pull requests, once read; none away from GitHub or signed out. */
  readonly pulls = signal<Pull[] | null>(null);

  constructor() {
    // on GitHub, signed in: the pull requests, and the pictures of the authors
    effect(() => {
      const repository = this.github()?.repository;
      const signedIn = !!this.hub.account();
      untracked(() => {
        this.pulls.set(null);
        if (!repository || !signedIn) return;
        void this.readPulls();
        void this.hub.picture(repository);
      });
    });
    // the diff on screen read again when spaces start or stop counting
    effect(() => {
      this.preferences.preferences().ignoreWhitespace;
      untracked(() => {
        const open = this.diff();
        if (open) this.showDiff(open.change, open.where);
      });
    });
  }

  /** Opens the repository holding `path`; false when it cannot. */
  async open(path: string): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);
    try {
      let snapshot = await invoke<Snapshot>('open_repository', { path });
      this.diff.set(null);
      this.selectedId.set(null);
      this.undoable.set([]);
      this.redoable.set([]);
      const view = this.store.settings().views[snapshot.path];
      if (view && (view.hidden.length || view.solo.length)) {
        snapshot = await invoke<Snapshot>('set_view', { path: snapshot.path, view });
      }
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
  /**
   * Reads the history further back, once its end is in sight; until a read brings no more
   * commits.
   */
  async readMore(): Promise<void> {
    const path = this.snapshot()?.path;
    if (!path || this.reading || this.readAll || this.working()) return;
    this.reading = true;
    this.activity.set('read_more');
    const before = this.snapshot()!.commits.length;
    try {
      this.apply(await invoke<Snapshot>('read_more', { path }));
      this.readAll = this.snapshot()!.commits.length === before;
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.reading = false;
      this.activity.set(null);
    }
  }

  /** Opens the repository, or one of its files, in the editor the settings name. */
  async openInEditor(file: string | null): Promise<void> {
    const path = this.snapshot()?.path;
    if (!path) return;
    try {
      await invoke('open_in_editor', {
        path,
        file,
        command: this.preferences.preferences().editor,
      });
    } catch (e) {
      this.error.set(String(e));
    }
  }

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
    if (this.comparison()) this.endComparison();
    this.selectedId.set(id);
    if (id === WIP) return;
    this.loadCommitFiles(id);
    if (!this.stashes().has(id)) void this.loadSignature(id);
  }

  private async loadSignature(id: string) {
    const path = this.snapshot()?.path;
    if (!path || this.signature()?.id === id) return;
    try {
      const signature = await invoke<Signature | null>('signature', { path, id });
      if (this.selectedId() === id) this.signature.set({ id, signature });
    } catch (e) {
      console.warn('signature not read', e);
    }
  }

  stage(files: string[]) {
    return this.change('stage', { files });
  }

  unstage(files: string[]) {
    return this.change('unstage', { files });
  }

  /** Compares the commit `from` with `to`: the files that differ, each diff a click away. */
  async compare(from: Named, to: Named): Promise<void> {
    const path = this.snapshot()?.path;
    if (!path) return;
    this.filePanel.set(null);
    this.diff.set(null);
    const comparison: Comparison = { from, to, files: null };
    this.comparison.set(comparison);
    try {
      const files = await invoke<Change[]>('compare_files', { path, from: from.id, to: to.id });
      if (this.comparison() === comparison) this.comparison.set({ ...comparison, files });
    } catch (e) {
      this.error.set(String(e));
      if (this.comparison() === comparison) this.comparison.set(null);
    }
  }

  endComparison() {
    this.comparison.set(null);
    if (this.diff()?.where.kind === 'compare') this.diff.set(null);
  }

  /** Resolves a conflict with one side's version of the whole file. */
  takeVersion(file: string, version: Version) {
    return this.change('take', { file, version });
  }

  /** Stages, unstages or throws away some of a file's changed lines. */
  applyLines(file: string, part: Part, lines: Picked[]) {
    return this.change('apply_lines', { file, part, lines });
  }

  /**
   * Commits what is staged with the message written, as the profile in use; into the last
   * commit when amending. True once done.
   */
  async commit(): Promise<boolean> {
    const summary = this.summary().trim();
    const description = this.description().trim();
    const message = description ? `${summary}\n\n${description}` : summary;
    const amend = this.amending();
    const done = await this.change(
      'commit',
      { message, amend, identity: this.profiles.identity() },
      {
        what: amend ? t('the amend of the last commit') : t('the commit “{s}”', { s: summary }),
        how: 'soft',
      },
    );
    if (!done) return false;
    this.summary.set('');
    this.description.set('');
    this.amending.set(false);
    if (!this.changes()) this.select(this.headId() ?? WIP);
    return true;
  }

  /**
   * Starts or stops amending. The last commit's message is written in when nothing is yet,
   * and taken out again, untouched, when amending stops.
   */
  amend(on: boolean) {
    const head = this.snapshot()?.commits.find((c) => c.id === this.headId());
    if (!head) return;
    this.amending.set(on);
    const theirs = this.summary() === head.summary && this.description() === head.body;
    if (on && !this.summary().trim() && !this.description().trim()) {
      this.summary.set(head.summary);
      this.description.set(head.body);
    } else if (!on && theirs) {
      this.summary.set('');
      this.description.set('');
    }
  }

  /** Puts every change aside, under the summary being written when there is one. */
  async stash(): Promise<void> {
    const message = this.summary().trim() || null;
    const identity = this.profiles.identity();
    if (await this.change('stash', { message, files: [], identity })) {
      if (message) this.summary.set('');
    }
  }

  /** Puts the changes of some files aside, the others staying. */
  stashFiles(files: string[]) {
    return this.change('stash', { message: null, files, identity: this.profiles.identity() });
  }

  /** Throws away the changes of some files, their staged ones too when `staged`. */
  discard(files: string[], staged: boolean) {
    return this.change('discard', { files, staged });
  }

  /** Throws away every change of the working tree, new files included. */
  discardAll() {
    return this.change('discard_all', {});
  }

  /** Adds a pattern to the repository's .gitignore. */
  ignore(pattern: string) {
    return this.change('ignore', { pattern });
  }

  deleteFile(file: string) {
    return this.change('delete_file', { file });
  }

  /** Writes a file of the working tree; its changes show at once. */
  writeFile(file: string, text: string) {
    return this.change('write_file', { file, text });
  }

  /** Shows the terminal, opening one first; hides it when in sight, its shell kept. */
  toggleTerminal() {
    const shown = !this.terminalShown();
    this.terminalShown.set(shown);
    if (shown) this.terminalOpen.set(true);
  }

  /** Ends the terminal and its shell. */
  closeTerminal() {
    this.terminalShown.set(false);
    this.terminalOpen.set(false);
  }

  /** A file's history, blame or editor, in place of any diff. */
  openFile(panel: FilePanel) {
    this.diff.set(null);
    this.filePanel.set(panel);
  }

  /** Runs a command about one file of the working tree, telling a failure. */
  async onFile(command: 'open_file' | 'reveal_file', file: string): Promise<void> {
    const path = this.snapshot()?.path;
    if (!path) return;
    try {
      await invoke(command, { path, file });
    } catch (e) {
      this.error.set(String(e));
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
    return this.createBranchAt(name, id && id !== WIP ? id : null);
  }

  createBranchAt(name: string, start: string | null) {
    return this.change(
      'create_branch',
      { name, start },
      this.undoing(t('the new branch {name}', { name })),
    );
  }

  /** HEAD on the commit `id`, on no branch. */
  checkoutCommit(id: string) {
    const what = { id: id.slice(0, 7) };
    return this.change('checkout_commit', { id }, this.undoing(t('the switch to {id}', what)));
  }

  cherryPick(id: string) {
    const what = this.undoing(t('the cherry-pick of {id}', { id: id.slice(0, 7) }));
    return this.change('cherry_pick', { id, identity: this.profiles.identity() }, what);
  }

  revert(id: string) {
    const what = this.undoing(t('the revert of {id}', { id: id.slice(0, 7) }));
    return this.change('revert', { id, identity: this.profiles.identity() }, what);
  }

  /** The current branch's own commits replayed on top of `onto`. */
  rebase(onto: string) {
    const what = this.undoing(t('the rebase onto {id}', { id: onto.slice(0, 7) }));
    return this.change('rebase', { onto, identity: this.profiles.identity() }, what);
  }

  /** The current branch moved to the commit `id`. */
  reset(id: string, mode: Reset) {
    const what = t('the reset to {id}', { id: id.slice(0, 7) });
    return this.change('reset', { id, mode }, { what, how: mode === 'hard' ? 'keep' : 'soft' });
  }

  /** A tag on the commit `id`; annotated with a message. */
  tag(name: string, id: string, message: string | null) {
    const args = { name, id, message, identity: this.profiles.identity() };
    return this.change('tag', args, this.undoing(t('the tag {name}', { name })));
  }

  /** Merges `from` into `into` (switched to first), or into the current branch. */
  merge(from: string, into: string | null) {
    const args = { from, into, identity: this.profiles.identity() };
    return this.change('merge', args, this.undoing(t('the merge of {name}', { name: from })));
  }

  /** Replays `branch` (switched to first) on top of `onto`. */
  rebaseBranch(branch: string, onto: string) {
    const args = { branch, onto, identity: this.profiles.identity() };
    return this.change(
      'rebase_branch',
      args,
      this.undoing(t('the rebase of {name}', { name: branch })),
    );
  }

  deleteBranch(name: string, force: boolean) {
    return this.change(
      'delete_branch',
      { name, force },
      this.undoing(t('the deletion of {name}', { name })),
    );
  }

  deleteRemoteBranch(name: string) {
    return this.change('delete_remote_branch', { name });
  }

  renameBranch(name: string, newName: string) {
    const what = this.undoing(t('the renaming of {name}', { name }));
    return this.change('rename_branch', { name, newName }, what);
  }

  setUpstream(name: string, upstream: string) {
    return this.change('set_upstream', { name, upstream });
  }

  pushBranch(name: string) {
    return this.change('push_branch', { name });
  }

  fetchRemote(name: string) {
    return this.change('fetch_remote', { name });
  }

  addRemote(name: string, url: string) {
    return this.change('add_remote', { name, url });
  }

  editRemote(name: string, newName: string, url: string) {
    return this.change('edit_remote', { name, newName, url });
  }

  removeRemote(name: string) {
    return this.change('remove_remote', { name });
  }

  deleteTag(name: string) {
    return this.change('delete_tag', { name }, this.undoing(t('the deletion of {name}', { name })));
  }

  pushTag(remote: string, name: string) {
    return this.change('push_tag', { remote, name });
  }

  /** The commits an interactive rebase onto `onto` replays, oldest first. */
  async rebasePlan(onto: string): Promise<Planned[]> {
    const path = this.snapshot()?.path;
    if (!path) return [];
    try {
      return await invoke<Planned[]>('rebase_plan', { path, onto });
    } catch (e) {
      this.error.set(String(e));
      return [];
    }
  }

  /** Gives a commit of the current branch a new message, author and date. */
  rewrite(id: string, to: Rewrite) {
    const args = { id, to, identity: this.profiles.identity() };
    return this.change(
      'rewrite',
      args,
      this.undoing(t('the rewrite of {id}', { id: id.slice(0, 7) })),
    );
  }

  rebaseInteractive(onto: string, steps: Step[]) {
    const args = { onto, steps, identity: this.profiles.identity() };
    return this.change('rebase_interactive', args, this.undoing(t('the interactive rebase')));
  }

  /** Hides a name from the history, or shows it again. */
  hide(key: string, hidden: boolean) {
    const view = this.view();
    const rest = view.hidden.filter((k) => k !== key);
    return this.setView({ ...view, hidden: hidden ? [...rest, key] : rest });
  }

  /** Draws the history from these names only; none draws it from every name again. */
  solo(keys: string[]) {
    return this.setView({ ...this.view(), solo: keys });
  }

  private async setView(view: View) {
    const path = this.snapshot()?.path;
    if (!path) return;
    this.store.update((s) => ({ ...s, views: { ...s.views, [path]: view } }));
    try {
      this.apply(await invoke<Snapshot>('set_view', { path, view }));
    } catch (e) {
      this.error.set(String(e));
    }
  }

  /** Takes back the last action undoable. */
  undo() {
    const last = this.undoable().at(-1);
    if (!last) return Promise.resolve(false);
    return this.travel(last, last.before, last.after, this.undoable, this.redoable);
  }

  /** Does again the last action undone. */
  redo() {
    const last = this.redoable().at(-1);
    if (!last) return Promise.resolve(false);
    return this.travel(last, last.after, last.before, this.redoable, this.undoable);
  }

  private async travel(
    entry: Undoable,
    to: RefState,
    from: RefState,
    taken: typeof this.undoable,
    given: typeof this.undoable,
  ): Promise<boolean> {
    const done = await this.change('restore', { to, from, how: entry.how });
    // done or not (the repository moved on meanwhile), it is off this list
    taken.update((list) => list.slice(0, -1));
    if (done) given.update((list) => [...list, entry]);
    return done;
  }

  /** An action undone by putting the names back, the files following. */
  private undoing(what: string): { what: string; how: Move } {
    return { what, how: 'keep' };
  }

  /** Gives up what git stopped in the middle of. */
  abortOperation() {
    const operation = this.snapshot()?.operation;
    return operation ? this.change('abort', { operation }) : Promise.resolve(false);
  }

  /** Goes on with what git stopped in the middle of, its conflicts resolved. */
  proceedOperation() {
    const operation = this.snapshot()?.operation;
    if (!operation) return Promise.resolve(false);
    return this.change('proceed', { operation, identity: this.profiles.identity() });
  }

  /** Reads the open pull requests again. */
  async readPulls(): Promise<void> {
    const repository = this.github()?.repository;
    if (!repository || !this.hub.account()) return;
    try {
      this.pulls.set(await invoke<Pull[]>('github_pulls', { repository }));
    } catch (e) {
      this.error.set(String(e));
    }
  }

  /**
   * Switches to a pull request's branch: one of this repository through its remote branch,
   * one of a fork on a branch `pr/<number>` of its own.
   */
  checkoutPull(pull: Pull) {
    const github = this.github();
    if (!github) return Promise.resolve(false);
    if (pull.headRepository === github.repository)
      return this.checkout(`${github.remote}/${pull.head}`, true);
    return this.change(
      'checkout_pull',
      { remote: github.remote, number: pull.number },
      this.undoing(t('the switch to #{n}', { n: pull.number })),
    );
  }

  checkout(name: string, remote: boolean) {
    return this.change(
      'checkout',
      { name, remote },
      this.undoing(t('the switch to {id}', { id: name })),
    );
  }

  /** Switches to a branch beside its commit; a remote one gives a local one following it. */
  async switchTo(label: RefLabel): Promise<void> {
    if (label.kind !== 'tag' && !label.head)
      await this.checkout(label.name, label.kind === 'remote');
  }

  /** A fetch nobody asked for (the settings' timer): a failure, offline say, stays quiet. */
  async fetchQuietly(): Promise<void> {
    const path = this.snapshot()?.path;
    if (!path || this.working()) return;
    try {
      const prune = this.preferences.preferences().prune;
      this.apply(await invoke<Snapshot>('fetch', { path, prune }));
    } catch (e) {
      console.warn('background fetch failed', e);
    }
  }

  /** Fetches, pulls or pushes; a forced push replaces what the upstream has. */
  async exchangeWith(kind: Exchange, force = false): Promise<void> {
    this.exchange.set(kind);
    try {
      if (kind === 'pull') {
        const what = { what: t('the pull'), how: 'keep' as const };
        const how = this.preferences.preferences().pull;
        await this.change(kind, { how, identity: this.profiles.identity() }, what);
      } else {
        const prune = this.preferences.preferences().prune;
        await this.change(kind, kind === 'push' ? { force } : { prune });
      }
      // what the remote has new, its pull requests too
      if (kind === 'fetch') void this.readPulls();
    } finally {
      this.exchange.set(null);
    }
  }

  /** Opens a file's diff, or closes it when it is the one on screen. */
  toggleDiff(change: Change, where: Where) {
    this.filePanel.set(null);
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
      const ignoreWhitespace = this.preferences.preferences().ignoreWhitespace;
      const diff = await invoke<FileDiff>('file_diff', {
        path,
        change,
        side: where,
        ignoreWhitespace,
      });
      if (this.diff()?.change === change) this.diff.set({ change, where, diff });
    } catch (e) {
      this.error.set(String(e));
      this.diff.set(null);
    }
  }

  /**
   * Runs a command that changes the repository and takes its new state; false on failure,
   * after which the repository is read again: git may have stopped halfway, on conflicts.
   */
  private async change(
    command: string,
    args: Record<string, unknown>,
    undoable?: { what: string; how: Move },
  ): Promise<boolean> {
    const path = this.snapshot()?.path;
    if (!path) return false;
    this.working.set(true);
    this.activity.set(command);
    this.error.set(null);
    let done = false;
    try {
      const before = undoable && (await invoke<RefState>('ref_state', { path }));
      this.apply(await invoke<Snapshot>(command, { path, ...args }));
      done = true;
      if (undoable && before) {
        const after = await invoke<RefState>('ref_state', { path });
        if (JSON.stringify(after) !== JSON.stringify(before)) {
          this.undoable.update((list) =>
            [...list, { ...undoable, before, after }].slice(-UNDO_DEPTH),
          );
          this.redoable.set([]);
        }
      }
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.working.set(false);
      this.activity.set(null);
    }
    if (!done) {
      await this.refresh();
      // stopped on conflicts: the banner says so, and how to go on
      if (this.snapshot()?.operation) this.error.set(null);
    }
    return done;
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
    // commits compared stay what they are
    if (diff?.where.kind === 'compare') return;
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
