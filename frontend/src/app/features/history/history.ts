import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Commit, GraphRow, RefLabel } from '../../core/models/repository';
import { PreferencesService } from '../../core/services/preferences.service';
import { GravatarService } from '../../core/services/gravatar.service';
import { RepositoryService, WIP } from '../../core/services/repository.service';
import { Ask, AskDialog } from '../../shared/ask-dialog';
import { initials } from '../../shared/avatar';
import { ContextMenu, MenuEntry } from '../../shared/context-menu';
import { speedUpWheel } from '../../shared/wheel';
import { commitUrl } from '../../shared/web-url';
import { fullDate, shortDate, when } from '../../shared/when';
import {
  MERGE,
  NODE,
  PICTURE,
  ROW,
  STASH,
  Shape,
  graphWidth,
  laneColor,
  laneX,
  shape,
} from './graph';
import { RefPill } from './ref-pill';

/** Lanes the graph column shows at first; more once it is widened. */
const FIRST_LANES = 6;
/** Wide enough for its heading. */
const MIN_GRAPH_WIDTH = 64;
/** Rows drawn beyond each edge of the view, so that scrolling never shows a gap. */
const OVERSCAN = 16;
/** The rows drawn change by this many at a time: scrolling within draws nothing new. */
const CHUNK = 4;
/** Tells each history's clip paths from another tab's. */
let histories = 0;

/** A row as drawn, all of it worked out once for the whole history. */
interface Line {
  commit: Commit;
  row: GraphRow;
  shape: Shape;
  labels: RefLabel[];
  initials: string;
  /** The first line of the description, after the summary. */
  detail: string;
  date: string;
  fullDate: string;
}

/** The names on a commit, unfolded over the rows below while the pointer is on them. */
interface Unfolded {
  id: string;
  labels: RefLabel[];
  color: string;
  top: number;
  left: number;
  width: number;
}

/**
 * The history: one line per commit, its branches and tags on the left, then the graph.
 * Only the rows in view are drawn, between two spacers as tall as the rows left out.
 */
@Component({
  selector: 'app-history',
  templateUrl: './history.html',
  styleUrl: './history.scss',
  imports: [TPipe, RefPill, ContextMenu, AskDialog],
})
export class History {
  protected readonly repository = inject(RepositoryService);
  protected readonly gravatar = inject(GravatarService);
  private readonly preferences = inject(PreferencesService);
  protected readonly wipId = WIP;
  protected readonly row = ROW;
  protected readonly node = NODE;
  protected readonly mergeR = MERGE;
  protected readonly pictureR = PICTURE;
  protected readonly stashSide = STASH;
  protected readonly clip = `history-${++histories}-`;
  protected readonly unfolded = signal<Unfolded | null>(null);
  /** A commit's menu, open where it was asked for. */
  protected readonly menu = signal<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  /** A question asked before an action: a name to give, a yes to say. */
  protected readonly asking = signal<Ask | null>(null);
  /** The graph's width as the user dragged it, null until then. */
  private readonly dragged = signal<number | null>(null);
  private readonly rows = viewChild<ElementRef<HTMLElement>>('rows');
  private readonly scrollTop = signal(0);
  private readonly viewHeight = signal(0);

  /** The working tree's changes above the history, joined to HEAD's commit when it is the first. */
  protected readonly wip = computed(() => {
    if (!this.repository.changes()) return null;
    const snapshot = this.repository.snapshot();
    const head = this.repository.headId();
    const linked = !!snapshot && snapshot.commits[0]?.id === head;
    const lane = linked ? snapshot.graph[0].lane : 0;
    return { x: laneX(lane), color: laneColor(lane), linked };
  });

  protected readonly lines = computed<Line[]>(() => {
    const snapshot = this.repository.snapshot();
    if (!snapshot) return [];
    const labels = this.repository.labels();
    const stashes = this.repository.stashes();
    const relative = this.preferences.preferences().relativeDates;
    const now = Date.now() / 1000;
    return snapshot.commits.map((commit, i) => {
      const row = snapshot.graph[i];
      const node = stashes.has(commit.id)
        ? 'stash'
        : commit.parents.length > 1
          ? 'merge'
          : 'commit';
      return {
        commit,
        row,
        shape: shape(row, node),
        labels: labels.get(commit.id) ?? [],
        initials: initials(commit.author),
        detail: commit.body.split('\n', 1)[0],
        date: relative ? when(commit.time, now) : shortDate(commit.time),
        fullDate: fullDate(commit.time),
      };
    });
  });

  /**
   * The commits' rows drawn, as indexes into [`lines`]: from `start`, up to `end`. They
   * move by whole chunks, so that most scrolling changes nothing to draw.
   */
  protected readonly range = computed(
    () => {
      const count = this.lines().length;
      const top = this.scrollTop() - (this.wip() ? ROW : 0);
      const first = Math.floor(Math.max(0, top) / ROW / CHUNK) * CHUNK;
      const last = Math.ceil((top + this.viewHeight()) / ROW / CHUNK) * CHUNK;
      const start = Math.min(count, Math.max(0, first - OVERSCAN));
      const end = Math.min(count, Math.max(start, last + OVERSCAN));
      return { start, end };
    },
    { equal: (a, b) => a.start === b.start && a.end === b.end },
  );

  protected readonly shown = computed(() => {
    const { start, end } = this.range();
    return this.lines().slice(start, end);
  });

  /** Wide enough for every lane. */
  private readonly fullWidth = computed(() =>
    Math.max(MIN_GRAPH_WIDTH, graphWidth(Math.max(1, ...this.lines().map((l) => l.row.width)))),
  );

  /** The graph column: the lanes beyond its edge go out of sight. */
  protected readonly graphWidth = computed(
    () =>
      this.dragged() ??
      Math.min(this.fullWidth(), Math.max(MIN_GRAPH_WIDTH, graphWidth(FIRST_LANES))),
  );

  constructor() {
    // listened to here rather than in the template: a scroll redraws nothing by itself
    effect((onCleanup) => {
      const view = this.rows()?.nativeElement;
      if (!view) return;
      const observer = new ResizeObserver(() => this.viewHeight.set(view.clientHeight));
      observer.observe(view);
      const scrolled = () => {
        this.scrollTop.set(view.scrollTop);
        if (this.unfolded()) this.unfolded.set(null);
      };
      view.addEventListener('scroll', scrolled, { passive: true });
      const wheel = speedUpWheel(view, () => this.preferences.preferences().scrollSpeed);
      onCleanup(() => {
        observer.disconnect();
        view.removeEventListener('scroll', scrolled);
        wheel();
      });
    });
    // a commit chosen elsewhere (a branch in the sidebar) is brought into view
    effect(() => {
      const id = this.repository.selectedId();
      untracked(() => this.reveal(id));
    });
  }

  private reveal(id: string | null) {
    const view = this.rows()?.nativeElement;
    if (!view || !id) return;
    const index = id === WIP ? -1 : this.lines().findIndex((line) => line.commit.id === id);
    if (id !== WIP && index < 0) return;
    const top = id === WIP ? 0 : (this.wip() ? ROW : 0) + index * ROW;
    if (top < view.scrollTop) view.scrollTop = top;
    else if (top + ROW > view.scrollTop + view.clientHeight)
      view.scrollTop = top + ROW - view.clientHeight;
  }

  /** Drags the graph column's edge, from its heading. */
  protected resize(event: PointerEvent) {
    const handle = event.target as HTMLElement;
    const start = event.clientX - this.graphWidth();
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) =>
      this.dragged.set(Math.min(this.fullWidth(), Math.max(MIN_GRAPH_WIDTH, e.clientX - start)));
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move), {
      once: true,
    });
  }

  /** A commit's menu, the commit selected. */
  protected openMenu(event: MouseEvent, commit: Commit) {
    event.preventDefault();
    this.repository.select(commit.id);
    this.menu.set({ x: event.clientX, y: event.clientY, entries: this.entriesFor(commit) });
  }

  private ask(question: Ask) {
    this.asking.set({
      ...question,
      answered: (values) => {
        this.asking.set(null);
        question.answered(values);
      },
    });
  }

  /** What can be done from a commit, or from a stash. */
  private entriesFor(commit: Commit): MenuEntry[] {
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
    const snapshot = r.snapshot()!;
    const branch = snapshot.head.kind === 'branch' ? snapshot.head.name : null;
    const isHead = commit.id === r.headId();
    const id = commit.id.slice(0, 7);
    const remote = snapshot.remotes.find((x) => x.name === 'origin') ?? snapshot.remotes[0];
    const link = remote && commitUrl(remote.url, commit.id);
    const tagName = { label: t('Tag name'), placeholder: 'v1.0.0', code: true };
    return [
      {
        label: t('Check out this commit'),
        disabled: isHead && !branch,
        run: () => r.checkoutCommit(commit.id),
      },
      null,
      {
        label: t('Create a branch here…'),
        run: () =>
          this.ask({
            title: t('A new branch at {id}', { id }),
            fields: [{ label: t('Branch name'), code: true }],
            confirm: t('Create and switch'),
            answered: ([name]) => r.createBranchAt(name, commit.id),
          }),
      },
      { label: t('Cherry-pick this commit'), disabled: isHead, run: () => r.cherryPick(commit.id) },
      {
        label: branch
          ? t('Rebase {branch} onto this commit', { branch })
          : t('Rebase onto this commit'),
        disabled: !branch || isHead,
        run: () => r.rebase(commit.id),
      },
      {
        label: branch ? t('Reset {branch} to this commit', { branch }) : t('Reset to this commit'),
        disabled: !branch,
        children: [
          { label: t('Soft: keep every change, staged'), run: () => r.reset(commit.id, 'soft') },
          { label: t('Mixed: keep the changes, unstaged'), run: () => r.reset(commit.id, 'mixed') },
          {
            label: t('Hard: throw every change away…'),
            danger: true,
            run: () =>
              this.ask({
                title: t('Reset {branch} hard?', { branch: branch ?? '' }),
                text: t(
                  'The branch goes back to {id}: its later commits and every change in the working tree are thrown away.',
                  { id },
                ),
                fields: [],
                confirm: t('Reset hard'),
                danger: true,
                answered: () => r.reset(commit.id, 'hard'),
              }),
          },
        ],
      },
      { label: t('Revert this commit'), run: () => r.revert(commit.id) },
      null,
      { label: t('Copy the commit’s id'), run: () => navigator.clipboard.writeText(commit.id) },
      ...(remote && link
        ? [
            {
              label: t('Copy the link to this commit on {remote}', { remote: remote.name }),
              run: () => navigator.clipboard.writeText(link),
            },
          ]
        : []),
      null,
      {
        label: t('Create a tag here…'),
        run: () =>
          this.ask({
            title: t('A new tag at {id}', { id }),
            fields: [tagName],
            confirm: t('Create the tag'),
            answered: ([name]) => r.tag(name, commit.id, null),
          }),
      },
      {
        label: t('Create an annotated tag here…'),
        run: () =>
          this.ask({
            title: t('A new annotated tag at {id}', { id }),
            text: t('It keeps who made it, when, and a message: the usual kind for a release.'),
            fields: [tagName, { label: t('Message'), multiline: true }],
            confirm: t('Create the tag'),
            answered: ([name, message]) => r.tag(name, commit.id, message || name),
          }),
      },
    ];
  }

  /** Several names on a commit: all of them, over the rows below, under the pointer. */
  protected unfold(event: MouseEvent, line: Line) {
    if (line.labels.length < 2) return;
    const cell = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.unfolded.set({
      id: line.commit.id,
      labels: line.labels,
      color: line.shape.color,
      top: cell.top,
      left: cell.left,
      width: cell.width,
    });
  }
}
