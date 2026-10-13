import { Component, computed, effect, inject } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { Commit, GraphRow } from '../../core/models/repository';
import { RepositoryService, WIP } from '../../core/services/repository.service';
import { when } from '../../shared/when';
import { GraphCell, ROW, graphWidth, laneColor, laneX } from './graph-cell';

/** Lanes the graph column shows before it scrolls them out of view. */
const MAX_LANES = 14;
/** Wide enough for its heading. */
const MIN_GRAPH_WIDTH = 64;

interface Line {
  commit: Commit;
  row: GraphRow;
  color: string;
}

/** The history: one line per commit, the graph on the left. */
@Component({
  selector: 'app-history',
  templateUrl: './history.html',
  styleUrl: './history.scss',
  imports: [TPipe, GraphCell],
})
export class History {
  protected readonly repository = inject(RepositoryService);
  protected readonly when = when;
  protected readonly wipId = WIP;
  protected readonly row = ROW;

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
    return snapshot.commits.map((commit, i) => ({
      commit,
      row: snapshot.graph[i],
      color: laneColor(snapshot.graph[i].lane),
    }));
  });

  protected readonly graphWidth = computed(() =>
    Math.max(
      MIN_GRAPH_WIDTH,
      graphWidth(Math.min(MAX_LANES, Math.max(1, ...this.lines().map((l) => l.row.width)))),
    ),
  );

  constructor() {
    // a commit chosen elsewhere (a branch in the sidebar) is brought into view
    effect(() => {
      const id = this.repository.selectedId();
      if (id) document.getElementById(`commit-${id}`)?.scrollIntoView({ block: 'nearest' });
    });
  }
}
