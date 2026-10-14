import { Injectable, computed, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../core/i18n/i18n';
import { Pull } from '../../core/models/github';
import { Change, Commit, Planned, Where } from '../../core/models/repository';
import { GithubService } from '../../core/services/github.service';
import { editorName } from '../../core/models/settings';
import { PreferencesService } from '../../core/services/preferences.service';
import { RepositoryService } from '../../core/services/repository.service';
import { Ask } from '../../shared/ask-dialog';
import { reaches } from '../../shared/ancestry';
import { MenuEntry } from '../../shared/context-menu';
import { branchUrl, commitUrl, remoteUrl } from '../../shared/web-url';

/** A menu open where it was asked for. */
export interface OpenMenu {
  x: number;
  y: number;
  entries: MenuEntry[];
}

/** An interactive rebase being planned: the commits it replays, onto what. */
export interface Rebasing {
  onto: string;
  ontoName: string;
  plan: Planned[];
}

/**
 * One tab's menus (of a commit, a branch, a remote, a tag, a drop) and the questions they
 * ask before acting; the history and the sidebar open them, the tab shows them.
 */
@Injectable()
export class MenusService {
  private readonly repository = inject(RepositoryService);
  private readonly preferences = inject(PreferencesService);
  private readonly github = inject(GithubService);
  readonly menu = signal<OpenMenu | null>(null);
  readonly asking = signal<Ask | null>(null);
  readonly rebasing = signal<Rebasing | null>(null);
  /** The commit whose message, author and date are being told again. */
  readonly rewriting = signal<Commit | null>(null);

  /** The branch checked out, if any. */
  private readonly current = computed(() => {
    const head = this.repository.snapshot()?.head;
    return head?.kind === 'branch' ? head.name : null;
  });

  /** The remote links point to: `origin`, else the first one. */
  private readonly remote = computed(() => {
    const remotes = this.repository.snapshot()?.remotes ?? [];
    return remotes.find((r) => r.name === 'origin') ?? remotes[0] ?? null;
  });

  /** A menu at the pointer (a right click). */
  open(event: MouseEvent, entries: MenuEntry[]) {
    event.preventDefault();
    event.stopPropagation();
    this.menu.set({ x: event.clientX, y: event.clientY, entries });
  }

  /** A menu under the button that asked for it (the ⋯ of a row). */
  openUnder(button: HTMLElement, entries: MenuEntry[]) {
    const box = button.getBoundingClientRect();
    this.menu.set({ x: box.left, y: box.bottom + 4, entries });
  }

  ask(question: Ask) {
    this.asking.set({
      ...question,
      answered: (values) => {
        this.asking.set(null);
        question.answered(values);
      },
    });
  }

  /** Plans an interactive rebase of the current branch onto `onto`. */
  async planRebase(onto: string, ontoName: string) {
    const plan = await this.repository.rebasePlan(onto);
    if (plan.length) this.rebasing.set({ onto, ontoName, plan });
    else
      this.repository.error.set(t('There is nothing to replay onto {name}.', { name: ontoName }));
  }

  /** What can be done from a commit, or from a stash. */
  forCommit(commit: Commit): MenuEntry[] {
    const r = this.repository;
    const stash = r.stashes().get(commit.id);
    if (stash) {
      return [
        { label: t('Pop this stash'), run: () => r.restore(stash, true) },
        { label: t('Apply this stash'), run: () => r.restore(stash, false) },
        null,
        {
          label: t('Delete this stash…'),
          danger: true,
          run: () =>
            this.ask({
              title: t('Delete this stash?'),
              text: stash.message,
              fields: [],
              confirm: t('Delete'),
              danger: true,
              answered: () => r.dropStash(stash),
            }),
        },
      ];
    }
    const branch = this.current();
    const isHead = commit.id === r.headId();
    const id = commit.id.slice(0, 7);
    const remote = this.remote();
    const link = remote && commitUrl(remote.url, commit.id);
    return [
      {
        label: t('Check out this commit'),
        disabled: isHead && !branch,
        run: () => r.checkoutCommit(commit.id),
      },
      null,
      this.createBranchAt(commit.id, id),
      { label: t('Cherry-pick this commit'), disabled: isHead, run: () => r.cherryPick(commit.id) },
      {
        label: branch
          ? t('Rebase {branch} onto this commit', { branch })
          : t('Rebase onto this commit'),
        disabled: !branch || isHead,
        run: () => r.rebase(commit.id),
      },
      {
        label: branch
          ? t('Interactive rebase of {branch} onto this commit…', { branch })
          : t('Interactive rebase onto this commit…'),
        disabled: !branch || isHead,
        run: () => this.planRebase(commit.id, id),
      },
      {
        label: branch ? t('Reset {branch} to this commit', { branch }) : t('Reset to this commit'),
        disabled: !branch,
        children: this.resets(commit.id, id),
      },
      { label: t('Revert this commit'), run: () => r.revert(commit.id) },
      {
        label: t('Edit the commit…'),
        disabled: !reaches(r.snapshot()?.commits ?? [], r.headId(), commit.id),
        run: () => this.rewriting.set(commit),
      },
      null,
      { label: t('Copy the commit’s id'), run: () => this.copy(commit.id) },
      ...(remote && link
        ? [
            {
              label: t('Copy the link to this commit on {remote}', { remote: remote.name }),
              run: () => this.copy(link),
            },
          ]
        : []),
      null,
      ...this.tagsAt(commit.id, id),
    ];
  }

  /** What can be done from a local branch. */
  forBranch(name: string): MenuEntry[] {
    const r = this.repository;
    const branch = this.current();
    const isCurrent = name === branch;
    const target = this.targetOf('branch', name);
    const remote = this.remote();
    const link = remote && branchUrl(remote.url, name);
    return [
      {
        label: t('Check out {name}', { name }),
        disabled: isCurrent,
        run: () => r.checkout(name, false),
      },
      ...this.joining(name),
      null,
      ...(isCurrent
        ? [
            {
              label: t('Pull {name}', { name }),
              disabled: !r.snapshot()?.status.upstream,
              run: () => r.exchangeWith('pull'),
            },
            { label: t('Push {name}', { name }), run: () => this.push() },
          ]
        : [{ label: t('Push {name}', { name }), run: () => r.pushBranch(name) }]),
      ...(r.github() && this.github.account()
        ? [{ label: t('Create a pull request…'), run: () => this.createPull(name) }]
        : []),
      {
        label: t('Set the upstream of {name}…', { name }),
        run: () =>
          this.ask({
            title: t('The remote branch {name} follows', { name }),
            fields: [
              {
                label: t('Remote branch'),
                code: true,
                value: `${remote?.name ?? 'origin'}/${name}`,
              },
            ],
            confirm: t('Follow it'),
            answered: ([upstream]) => r.setUpstream(name, upstream),
          }),
      },
      null,
      ...(target ? [this.createBranchAt(target, name)] : []),
      {
        label: t('Rename {name}…', { name }),
        run: () =>
          this.ask({
            title: t('Rename {name}', { name }),
            fields: [{ label: t('New name'), code: true, value: name }],
            confirm: t('Rename'),
            answered: ([to]) => to !== name && r.renameBranch(name, to),
          }),
      },
      {
        label: t('Delete {name}…', { name }),
        danger: true,
        disabled: isCurrent,
        run: () =>
          this.ask({
            title: t('Delete the branch {name}?', { name }),
            text: t('Its commits found nowhere else go with it; Undo brings it back.'),
            fields: [],
            confirm: t('Delete'),
            danger: true,
            answered: () => r.deleteBranch(name, true),
          }),
      },
      null,
      { label: t('Copy the branch name'), run: () => this.copy(name) },
      ...(remote && link
        ? [
            {
              label: t('Copy the link to the branch on {remote}', { remote: remote.name }),
              run: () => this.copy(link),
            },
          ]
        : []),
      null,
      ...this.visibility([`branch:${name}`]),
      ...this.lastCommit(target),
    ];
  }

  /** What can be done from a remote branch (`origin/feature`). */
  forRemoteBranch(name: string): MenuEntry[] {
    const r = this.repository;
    const target = this.targetOf('remote', name);
    const [remoteName, ...rest] = name.split('/');
    const remote = r.snapshot()?.remotes.find((x) => x.name === remoteName);
    const link = remote && branchUrl(remote.url, rest.join('/'));
    return [
      { label: t('Check out {name}', { name }), run: () => r.checkout(name, true) },
      ...this.joining(name),
      null,
      ...(target ? [this.createBranchAt(target, name)] : []),
      {
        label: t('Delete {name} from {remote}…', { name, remote: remoteName }),
        danger: true,
        run: () =>
          this.ask({
            title: t('Delete {name} from {remote}?', { name, remote: remoteName }),
            text: t('The branch goes from the remote, for everyone working with it.'),
            fields: [],
            confirm: t('Delete'),
            danger: true,
            answered: () => r.deleteRemoteBranch(name),
          }),
      },
      null,
      { label: t('Copy the branch name'), run: () => this.copy(name) },
      ...(remote && link
        ? [
            {
              label: t('Copy the link to the branch on {remote}', { remote: remote.name }),
              run: () => this.copy(link),
            },
          ]
        : []),
      null,
      ...this.visibility([`remote:${name}`]),
      ...this.lastCommit(target),
    ];
  }

  /** What can be done from a remote. */
  forRemote(name: string): MenuEntry[] {
    const r = this.repository;
    const remote = r.snapshot()?.remotes.find((x) => x.name === name);
    const keys = (r.snapshot()?.remoteBranches ?? [])
      .filter((b) => b.name.startsWith(`${name}/`))
      .map((b) => `remote:${b.name}`);
    const page = remote && remoteUrl(remote.url);
    return [
      { label: t('Fetch {name}', { name }), run: () => r.fetchRemote(name) },
      null,
      {
        label: t('Edit {name}…', { name }),
        run: () =>
          this.ask({
            title: t('Edit the remote {name}', { name }),
            fields: [
              { label: t('Name'), code: true, value: name },
              { label: t('URL'), code: true, value: remote?.url ?? '' },
            ],
            confirm: t('Save'),
            answered: ([to, url]) => r.editRemote(name, to, url),
          }),
      },
      {
        label: t('Remove {name}…', { name }),
        danger: true,
        run: () =>
          this.ask({
            title: t('Remove the remote {name}?', { name }),
            text: t('Only this copy forgets it: the remote itself is left as it is.'),
            fields: [],
            confirm: t('Remove'),
            danger: true,
            answered: () => r.removeRemote(name),
          }),
      },
      null,
      ...this.visibility(keys),
      ...(page
        ? [
            null,
            {
              label: t('Copy the link to the remote {name}', { name }),
              run: () => this.copy(page),
            },
          ]
        : []),
    ];
  }

  /** What can be done from a tag. */
  forTag(name: string): MenuEntry[] {
    const r = this.repository;
    const remote = this.remote();
    return [
      ...(remote
        ? [
            {
              label: t('Push {name} to {remote}', { name, remote: remote.name }),
              run: () => r.pushTag(remote.name, name),
            },
          ]
        : []),
      {
        label: t('Delete {name}…', { name }),
        danger: true,
        run: () =>
          this.ask({
            title: t('Delete the tag {name}?', { name }),
            text: t('Only here: a copy pushed to a remote stays there.'),
            fields: [],
            confirm: t('Delete'),
            danger: true,
            answered: () => r.deleteTag(name),
          }),
      },
      null,
      { label: t('Copy the tag name'), run: () => this.copy(name) },
      null,
      ...this.visibility([`tag:${name}`]),
      ...this.lastCommit(this.targetOf('tag', name)),
    ];
  }

  /**
   * What can be done with a changed file: in the working tree, stage it or throw its
   * changes away, keep it out of git; anywhere, look at its history, at who wrote it,
   * open it, edit it.
   */
  forFile(change: Change, where: Where): MenuEntry[] {
    const r = this.repository;
    const path = change.path;
    const name = path.slice(path.lastIndexOf('/') + 1);
    const gone = change.kind === 'deleted';
    const inTree = where.kind === 'staged' || where.kind === 'unstaged';
    // a file not committed yet has no history and nobody to blame
    const fresh = inTree && (change.kind === 'untracked' || change.kind === 'added');
    const at = inTree ? undefined : where.id;
    const looks: MenuEntry[] = [
      {
        label: t('File history'),
        disabled: fresh,
        run: () => r.openFile({ mode: 'history', path }),
      },
      {
        label: t('File blame'),
        disabled: fresh || gone,
        run: () => r.openFile({ mode: 'blame', path, at }),
      },
      null,
      { label: t('Open the file'), disabled: gone, run: () => r.onFile('open_file', path) },
      {
        label: t('Open in {editor}', { editor: this.editor() }),
        disabled: gone,
        run: () => r.openInEditor(path),
      },
      {
        label: t('Show it in its folder'),
        disabled: gone,
        run: () => r.onFile('reveal_file', path),
      },
      null,
      { label: t('Copy the file path'), run: () => this.copy(this.fullPath(path)) },
      null,
      { label: t('Edit the file'), disabled: gone, run: () => r.openFile({ mode: 'edit', path }) },
    ];
    if (!inTree) return looks;
    const staged = where.kind === 'staged';
    const conflicted: MenuEntry[] =
      change.kind === 'conflicted'
        ? [
            { label: t('Resolve the conflicts'), run: () => r.openFile({ mode: 'resolve', path }) },
            { label: t('Keep the current version'), run: () => r.takeVersion(path, 'current') },
            { label: t('Keep the incoming version'), run: () => r.takeVersion(path, 'incoming') },
            null,
          ]
        : [];
    return [
      ...conflicted,
      staged
        ? { label: t('Unstage'), run: () => r.unstage([path]) }
        : { label: t('Stage'), run: () => r.stage([path]) },
      {
        label: t('Discard the changes…'),
        danger: true,
        run: () =>
          this.ask({
            title: t('Discard the changes of {name}?', { name }),
            text:
              change.kind === 'untracked'
                ? t('The new file is deleted for good.')
                : staged
                  ? t('Its staged and unstaged changes are thrown away for good.')
                  : t('It goes back as it is staged, or committed, for good.'),
            fields: [],
            confirm: t('Discard'),
            danger: true,
            answered: () => r.discard([path], staged),
          }),
      },
      ...(staged ? [] : [{ label: t('Ignore'), children: this.ignoring(path) }]),
      { label: t('Stash the file'), run: () => r.stashFiles([path]) },
      null,
      ...looks,
      {
        label: t('Delete the file…'),
        danger: true,
        disabled: gone,
        run: () =>
          this.ask({
            title: t('Delete {name}?', { name }),
            text: t('It goes from the disk: only a version git kept can bring it back.'),
            fields: [],
            confirm: t('Delete'),
            danger: true,
            answered: () => r.deleteFile(path),
          }),
      },
    ];
  }

  /**
   * Pushes the current branch; one that has parted from its upstream (its commits
   * rewritten) only by force, once sure.
   */
  push() {
    const r = this.repository;
    const upstream = r.snapshot()?.status.upstream;
    if (!upstream?.ahead || !upstream.behind) return void r.exchangeWith('push');
    this.ask({
      title: t('Force push to {upstream}?', { upstream: upstream.name }),
      text: t(
        '{upstream} has commits this branch no longer has, rewritten here or pushed from elsewhere: they are replaced. Refused if someone pushed there since the last fetch.',
        { upstream: upstream.name },
      ),
      fields: [],
      confirm: t('Force push'),
      danger: true,
      answered: () => r.exchangeWith('push', true),
    });
  }

  /** What can be done with a pull request: check it out, see it on GitHub. */
  forPull(pull: Pull): MenuEntry[] {
    return [
      {
        label: t('Check out #{n}', { n: pull.number }),
        run: () => this.repository.checkoutPull(pull),
      },
      { label: t('Open on GitHub'), run: () => this.github.openPage(pull.url) },
      null,
      { label: t('Copy the link'), run: () => this.copy(pull.url) },
    ];
  }

  /**
   * Opens a pull request bringing the local branch `name` into another, asked for; the
   * branch is pushed first when its remote has not got it. The pull request opens on GitHub.
   */
  async createPull(name: string) {
    const r = this.repository;
    const github = r.github();
    if (!github) return;
    const base = await invoke<string>('github_default_branch', {
      repository: github.repository,
    }).catch(() => 'main');
    const last = r.snapshot()?.commits.find((c) => c.id === this.targetOf('branch', name));
    this.ask({
      title: t('A pull request for {name}', { name }),
      fields: [
        { label: t('Title'), value: last?.summary ?? name },
        { label: t('Description'), multiline: true, value: last?.body ?? '' },
        { label: t('Into the branch'), code: true, value: base },
      ],
      confirm: t('Open the pull request'),
      answered: ([title, body, into]) => void this.openPull(name, title, body, into),
    });
  }

  private async openPull(name: string, title: string, body: string, base: string) {
    const r = this.repository;
    const github = r.github()!;
    const remote = `${github.remote}/${name}`;
    if (!r.snapshot()?.remoteBranches.some((b) => b.name === remote) && !(await r.pushBranch(name)))
      return;
    try {
      const pull = await invoke<Pull>('github_create_pull', {
        repository: github.repository,
        title,
        body,
        head: name,
        base,
        draft: false,
      });
      await r.readPulls();
      void this.github.openPage(pull.url);
    } catch (e) {
      r.error.set(String(e));
    }
  }

  /** Throws away every change of the working tree, once sure. */
  discardAll() {
    this.ask({
      title: t('Discard every change?'),
      text: t('Every change, staged or not, and every new file is thrown away for good.'),
      fields: [],
      confirm: t('Discard everything'),
      danger: true,
      answered: () => this.repository.discardAll(),
    });
  }

  /** A local branch dropped on another: join them one way or the other. */
  forDrop(from: string, onto: string): MenuEntry[] {
    const r = this.repository;
    const into = onto === this.current() ? null : onto;
    return [
      { label: t('Merge {from} into {onto}', { from, onto }), run: () => r.merge(from, into) },
      {
        label: t('Rebase {from} onto {onto}', { from, onto }),
        run: () => r.rebaseBranch(from, onto),
      },
    ];
  }

  /** Merge, rebase and interactive rebase of the current branch with `name`. */
  private joining(name: string): MenuEntry[] {
    const branch = this.current();
    if (!branch || name === branch) return [];
    const r = this.repository;
    return [
      null,
      { label: t('Merge {name} into {branch}', { name, branch }), run: () => r.merge(name, null) },
      {
        label: t('Rebase {branch} onto {name}', { name, branch }),
        run: () => r.rebaseBranch(branch, name),
      },
      {
        label: t('Interactive rebase of {branch} onto {name}…', { name, branch }),
        run: () => this.planRebase(name, name),
      },
    ];
  }

  private resets(id: string, short: string): MenuEntry[] {
    const r = this.repository;
    const branch = this.current() ?? '';
    return [
      { label: t('Soft: keep every change, staged'), run: () => r.reset(id, 'soft') },
      { label: t('Mixed: keep the changes, unstaged'), run: () => r.reset(id, 'mixed') },
      {
        label: t('Hard: throw every change away…'),
        danger: true,
        run: () =>
          this.ask({
            title: t('Reset {branch} hard?', { branch }),
            text: t(
              'The branch goes back to {id}: its later commits and every change in the working tree are thrown away.',
              { id: short },
            ),
            fields: [],
            confirm: t('Reset hard'),
            danger: true,
            answered: () => r.reset(id, 'hard'),
          }),
      },
    ];
  }

  private createBranchAt(id: string, at: string): MenuEntry {
    return {
      label: t('Create a branch here…'),
      run: () =>
        this.ask({
          title: t('A new branch at {id}', { id: at }),
          fields: [{ label: t('Branch name'), code: true }],
          confirm: t('Create and switch'),
          answered: ([name]) => this.repository.createBranchAt(name, id),
        }),
    };
  }

  private tagsAt(id: string, short: string): MenuEntry[] {
    const r = this.repository;
    const tagName = { label: t('Tag name'), placeholder: 'v1.0.0', code: true };
    return [
      {
        label: t('Create a tag here…'),
        run: () =>
          this.ask({
            title: t('A new tag at {id}', { id: short }),
            fields: [tagName],
            confirm: t('Create the tag'),
            answered: ([name]) => r.tag(name, id, null),
          }),
      },
      {
        label: t('Create an annotated tag here…'),
        run: () =>
          this.ask({
            title: t('A new annotated tag at {id}', { id: short }),
            text: t('It keeps who made it, when, and a message: the usual kind for a release.'),
            fields: [tagName, { label: t('Message'), multiline: true }],
            confirm: t('Create the tag'),
            answered: ([name, message]) => r.tag(name, id, message || name),
          }),
      },
    ];
  }

  /** Hide or show these names, solo them or stop soloing. */
  private visibility(keys: string[]): MenuEntry[] {
    const r = this.repository;
    const view = r.view();
    const hidden = keys.length > 0 && keys.every((k) => view.hidden.includes(k));
    const soloed = keys.length > 0 && keys.every((k) => view.solo.includes(k));
    return [
      {
        label: hidden ? t('Show in the history') : t('Hide from the history'),
        disabled: !keys.length,
        run: () => keys.forEach((k) => r.hide(k, !hidden)),
      },
      {
        label: soloed ? t('Stop soloing') : t('Solo: show only this'),
        disabled: !keys.length,
        run: () => r.solo(soloed ? [] : keys),
      },
    ];
  }

  /** The actions of a name's commit, under one entry: they act on the commit, not the name. */
  private lastCommit(id: string | null): MenuEntry[] {
    const commit = id && this.repository.snapshot()?.commits.find((c) => c.id === id);
    if (!commit) return [];
    const flat = this.forCommit(commit).flatMap((entry) =>
      entry?.children
        ? entry.children.map((c) => c && { ...c, label: `${entry.label} · ${c.label}` })
        : [entry],
    );
    return [null, { label: t('Its commit'), children: flat }];
  }

  private targetOf(kind: 'branch' | 'remote' | 'tag', name: string): string | null {
    const s = this.repository.snapshot();
    if (!s) return null;
    const list = kind === 'branch' ? s.branches : kind === 'remote' ? s.remoteBranches : s.tags;
    return list.find((b) => b.name === name)?.target ?? null;
  }

  private copy(text: string) {
    void navigator.clipboard.writeText(text);
  }

  /** Keeping a file out of git: it alone, every file of its kind, or its whole folder. */
  private ignoring(path: string): MenuEntry[] {
    const r = this.repository;
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dir = path.slice(0, Math.max(path.lastIndexOf('/'), 0));
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? name.slice(dot) : null;
    return [
      { label: t('Ignore {name}', { name }), run: () => r.ignore(rooted(path)) },
      ...(extension
        ? [
            {
              label: t('Every file ending in {extension}', { extension }),
              run: () => r.ignore(`*${escapeGlob(extension)}`),
            },
          ]
        : []),
      ...(dir
        ? [
            {
              label: t('Everything in {dir}', { dir: `${dir}/` }),
              run: () => r.ignore(`${rooted(dir)}/`),
            },
          ]
        : []),
    ];
  }

  /** The editor the settings name, as the menus call it. */
  editor(): string {
    return editorName(this.preferences.preferences().editor);
  }

  /** A file of the working tree as the system names it. */
  private fullPath(path: string): string {
    const root = this.repository.snapshot()?.path ?? '';
    const windows = root.includes('\\');
    const sep = windows ? '\\' : '/';
    return root.replace(/[\\/]+$/, '') + sep + (windows ? path.replaceAll('/', '\\') : path);
  }
}

/** A .gitignore pattern matching `path` alone, from the repository's root. */
function rooted(path: string): string {
  return `/${escapeGlob(path)}`;
}

/** Wildcards taken literally in a .gitignore pattern. */
function escapeGlob(text: string): string {
  return text.replace(/[*?[\\]/g, '\\$&');
}
