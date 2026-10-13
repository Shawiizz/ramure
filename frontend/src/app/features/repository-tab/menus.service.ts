import { Injectable, computed, inject, signal } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { Commit, Planned } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';
import { Ask } from '../../shared/ask-dialog';
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
  readonly menu = signal<OpenMenu | null>(null);
  readonly asking = signal<Ask | null>(null);
  readonly rebasing = signal<Rebasing | null>(null);

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
            { label: t('Push {name}', { name }), run: () => r.exchangeWith('push') },
          ]
        : [{ label: t('Push {name}', { name }), run: () => r.pushBranch(name) }]),
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
}
