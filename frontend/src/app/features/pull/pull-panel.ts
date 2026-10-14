import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Pull, PullNote, PullThread, ReviewEvent } from '../../core/models/github';
import { PullFiles } from '../../core/models/repository';
import { GithubService } from '../../core/services/github.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { RepositoryService } from '../../core/services/repository.service';
import { FileList } from '../../shared/file-list';
import { markdown } from '../../shared/markdown';
import { TreeSwitch } from '../../shared/tree-switch';
import { fullDate, when } from '../../shared/when';
import { DiffView } from '../diff/diff-view';
import { MenusService } from '../repository-tab/menus.service';

/**
 * A pull request read in place of the history: its description, what was said and decided
 * about it, an answer or a review given back; or its files, each opening its diff.
 */
@Component({
  selector: 'app-pull-panel',
  templateUrl: './pull-panel.html',
  styleUrl: './pull-panel.scss',
  imports: [TPipe, FileList, TreeSwitch, DiffView],
})
export class PullPanel {
  protected readonly repository = inject(RepositoryService);
  protected readonly menus = inject(MenusService);
  protected readonly hub = inject(GithubService);
  private readonly preferences = inject(PreferencesService);
  protected readonly tree = computed(() => this.preferences.preferences().fileTree);
  protected readonly pull = computed(() => this.repository.pullOpen());
  protected readonly tab = signal<'conversation' | 'files'>('conversation');
  protected readonly thread = signal<PullThread | null>(null);
  protected readonly files = signal<PullFiles | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly reply = signal('');
  protected readonly sending = signal(false);

  /** The description and every note, made HTML once. */
  protected readonly said = computed(() => {
    const thread = this.thread();
    if (!thread) return null;
    return {
      description: thread.body.trim() ? markdown(thread.body) : null,
      notes: thread.notes.map((note) => ({ note, html: markdown(note.body) })),
    };
  });

  protected readonly state = computed(() => {
    const thread = this.thread();
    if (!thread) return null;
    if (thread.merged) return { kind: 'merged', name: t('Merged') };
    if (thread.state === 'closed') return { kind: 'closed', name: t('Closed') };
    return thread.draft ? { kind: 'draft', name: t('Draft') } : { kind: 'open', name: t('Open') };
  });

  protected readonly openPath = computed(() => {
    const diff = this.repository.diff();
    return diff?.where.kind === 'compare' ? diff.change.path : null;
  });

  constructor() {
    effect(() => {
      const pull = this.pull();
      untracked(() => {
        this.thread.set(null);
        this.files.set(null);
        this.failure.set(null);
        this.reply.set('');
        this.tab.set('conversation');
        this.repository.diff.set(null);
        if (pull) void this.read(pull);
      });
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected escape(event: Event) {
    // a diff open in the files closes first
    if (event.defaultPrevented || !this.repository.active() || this.repository.diff()) return;
    this.close();
  }

  protected close() {
    this.repository.pullOpen.set(null);
    this.repository.diff.set(null);
  }

  protected show(tab: 'conversation' | 'files') {
    this.tab.set(tab);
    const pull = this.pull();
    if (tab === 'files' && pull && !this.files()) void this.readFiles(pull);
  }

  /** What a note says it is: a comment, a verdict, a comment on a line. */
  protected verb(note: PullNote): string {
    if (note.kind === 'code') {
      const where = note.line ? `${note.path}:${note.line}` : (note.path ?? '');
      return t('commented on {file}', { file: where });
    }
    if (note.kind === 'comment') return t('commented');
    switch (note.state) {
      case 'APPROVED':
        return t('approved these changes');
      case 'CHANGES_REQUESTED':
        return t('requested changes');
      case 'DISMISSED':
        return t('reviewed, since dismissed');
      default:
        return t('reviewed');
    }
  }

  protected ago(time: string): string {
    return when(Date.parse(time) / 1000);
  }

  protected exactly(time: string): string {
    return fullDate(Date.parse(time) / 1000);
  }

  /** A link in what was said opens in the browser, never in the app's own window. */
  protected follow(event: MouseEvent) {
    const link = (event.target as HTMLElement).closest('a');
    if (!link) return;
    event.preventDefault();
    if (link.href.startsWith('https://')) void this.hub.openPage(link.href);
  }

  /** Comments, or reviews with what is written as the review's words. */
  protected async send(event: ReviewEvent | null) {
    const pull = this.pull();
    const repository = this.repository.github()?.repository;
    if (!pull || !repository) return;
    const body = this.reply().trim();
    this.sending.set(true);
    this.failure.set(null);
    try {
      if (event) await invoke('github_review', { repository, number: pull.number, event, body });
      else await invoke('github_comment', { repository, number: pull.number, body });
      this.reply.set('');
      await this.read(pull);
    } catch (e) {
      this.failure.set(String(e));
    } finally {
      this.sending.set(false);
    }
  }

  protected openFile(change: PullFiles['files'][number]) {
    const files = this.files();
    if (files)
      this.repository.toggleDiff(change, { kind: 'compare', from: files.from, to: files.to });
  }

  private async read(pull: Pull) {
    const repository = this.repository.github()?.repository;
    if (!repository) return;
    try {
      const thread = await invoke<PullThread>('github_pull', { repository, number: pull.number });
      if (this.pull() === pull) this.thread.set(thread);
    } catch (e) {
      if (this.pull() === pull) this.failure.set(String(e));
    }
  }

  private async readFiles(pull: Pull) {
    const github = this.repository.github();
    const path = this.repository.snapshot()?.path;
    if (!github || !path) return;
    try {
      const files = await invoke<PullFiles>('pull_files', {
        path,
        remote: github.remote,
        number: pull.number,
        base: pull.base,
        baseId: pull.baseId,
        head: pull.headId,
      });
      if (this.pull() === pull) this.files.set(files);
    } catch (e) {
      if (this.pull() === pull) this.failure.set(String(e));
    }
  }
}
