import { Component, computed, effect, inject } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { Commit, GraphRow } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';
import { when } from '../../shared/when';
import { GraphCell, graphWidth, laneColor } from './graph-cell';

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
