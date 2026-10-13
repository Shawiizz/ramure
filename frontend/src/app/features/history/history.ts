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
import { TPipe } from '../../core/i18n/t.pipe';
import { Commit, GraphRow, RefLabel } from '../../core/models/repository';
import { PreferencesService } from '../../core/services/preferences.service';
import { GravatarService } from '../../core/services/gravatar.service';
import { RepositoryService, WIP } from '../../core/services/repository.service';
import { initials } from '../../shared/avatar';
import { speedUpWheel } from '../../shared/wheel';
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
  imports: [TPipe, RefPill],
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
