import { Component, computed, effect, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { Commit, GraphRow, RefLabel } from '../../core/models/repository';
import { RepositoryService, WIP } from '../../core/services/repository.service';
import { initials } from '../../shared/avatar';
import { when } from '../../shared/when';
import { GraphCell, NODE, ROW, graphWidth, laneColor, laneX } from './graph-cell';
import { RefPill } from './ref-pill';

/** Lanes the graph column shows at first; more once it is widened. */
const FIRST_LANES = 6;
/** Wide enough for its heading. */
const MIN_GRAPH_WIDTH = 64;

interface Line {
  commit: Commit;
  row: GraphRow;
  color: string;
  labels: RefLabel[];
  initials: string;
  /** Work put aside, hanging on the commit it was made on. */
  stash: boolean;
  /** The first line of the description, after the summary. */
  detail: string;
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

/** The history: one line per commit, its branches and tags on the left, then the graph. */
@Component({
  selector: 'app-history',
  templateUrl: './history.html',
  styleUrl: './history.scss',
  imports: [TPipe, GraphCell, RefPill],
})
export class History {
  protected readonly repository = inject(RepositoryService);
  protected readonly when = when;
  protected readonly wipId = WIP;
  protected readonly row = ROW;
  protected readonly node = NODE;
  protected readonly unfolded = signal<Unfolded | null>(null);
  /** The graph's width as the user dragged it, null until then. */
  private readonly dragged = signal<number | null>(null);

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
    return snapshot.commits.map((commit, i) => ({
      commit,
      row: snapshot.graph[i],
      color: laneColor(snapshot.graph[i].lane),
      labels: labels.get(commit.id) ?? [],
      initials: initials(commit.author),
      stash: stashes.has(commit.id),
      detail: commit.body.split('\n', 1)[0],
    }));
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
    // a commit chosen elsewhere (a branch in the sidebar) is brought into view
    effect(() => {
      const id = this.repository.selectedId();
      if (id) document.getElementById(`commit-${id}`)?.scrollIntoView({ block: 'nearest' });
    });
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
      color: line.color,
      top: cell.top,
      left: cell.left,
      width: cell.width,
    });
  }
}
