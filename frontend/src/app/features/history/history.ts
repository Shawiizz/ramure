import {
  Component,
  ElementRef,
  HostListener,
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
import { OverlayScroll } from '../../shared/overlay-scroll';
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
import { MenusService } from '../repository-tab/menus.service';
import { t } from '../../core/i18n/i18n';
import { ColumnId, DEFAULT_COLUMNS } from '../../core/models/settings';
import { MenuEntry } from '../../shared/context-menu';
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
  imports: [TPipe, RefPill, OverlayScroll],
})
export class History {
  protected readonly repository = inject(RepositoryService);
  protected readonly menus = inject(MenusService);
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
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('search');
  /** The column whose heading is being dragged. */
  protected readonly moving = signal<ColumnId | null>(null);
  protected readonly searching = signal(false);
  protected readonly query = signal('');
  /** The match in front, by its index among the matches. */
  protected readonly at = signal(0);

  /** The columns shown, in their order. */
  protected readonly columns = computed(() =>
    this.preferences
      .preferences()
      .columns.filter((c) => c.shown || c.id === 'message')
      .map((c) => c.id),
  );
  protected readonly titles = computed<Record<ColumnId, string>>(() => ({
    refs: t('Branch / tag'),
    graph: t('Graph'),
    message: t('Commit message'),
    author: t('Author'),
    date: t('Date'),
    sha: 'SHA',
  }));
  /** Where the names meet the graph: their column just before it, or just after. */
  protected readonly tie = computed<'left' | 'right' | null>(() => {
    const columns = this.columns();
    const refs = columns.indexOf('refs');
    const graph = columns.indexOf('graph');
    if (refs < 0 || graph < 0) return null;
    return refs === graph - 1 ? 'left' : refs === graph + 1 ? 'right' : null;
  });
  protected readonly descriptions = computed(() => this.preferences.preferences().descriptions);
  protected readonly pictures = computed(() => this.preferences.preferences().pictures);

  /** The commits the search finds, by id, newest first. */
  protected readonly matches = computed(() => {
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return this.lines()
      .filter(({ commit }) => {
        const text =
          `${commit.summary}\n${commit.body}\n${commit.author}\n${commit.email}`.toLowerCase();
        return words.every((w) => text.includes(w) || commit.id.startsWith(w));
      })
      .map((line) => line.commit.id);
  });
  protected readonly matching = computed(() => new Set(this.matches()));
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
    // the history's end in sight, older commits are read
    effect(() => {
      const { end } = this.range();
      if (end && end === this.lines().length && this.preferences.preferences().lazyHistory)
        untracked(() => void this.repository.readMore());
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

  /** The commits compared, lit like the one selected. */
  protected readonly compared = computed(() => {
    const comparison = this.repository.comparison();
    return new Set(comparison ? [comparison.from.id, comparison.to.id] : []);
  });

  /** Selects a commit; with Ctrl, compares the one selected with it. */
  protected pick(event: MouseEvent, commit: Commit) {
    const r = this.repository;
    const selected = r.selected();
    if (!(event.ctrlKey || event.metaKey) || !selected || selected.id === commit.id) {
      r.select(commit.id);
      return;
    }
    // from the older to the newer, as the history lists them
    const commits = r.snapshot()?.commits ?? [];
    const place = (c: Commit) => commits.findIndex((x) => x.id === c.id);
    const [from, to] = place(selected) > place(commit) ? [selected, commit] : [commit, selected];
    void r.compare(
      { id: from.id, name: from.id.slice(0, 7) },
      { id: to.id, name: to.id.slice(0, 7) },
    );
  }

  /** A commit's menu, the commit selected. */
  protected openMenu(event: MouseEvent, commit: Commit) {
    this.repository.select(commit.id);
    this.menus.open(event, this.menus.forCommit(commit));
  }

  /** A commit's menu from its ⋯ button. */
  protected openMenuUnder(button: HTMLElement, commit: Commit) {
    this.repository.select(commit.id);
    this.menus.openUnder(button, this.menus.forCommit(commit));
  }

  /** A branch's, remote branch's or tag's menu, from its label on the graph. */
  protected openLabelMenu(event: MouseEvent, label: RefLabel) {
    const m = this.menus;
    const entries =
      label.kind === 'branch'
        ? m.forBranch(label.name)
        : label.kind === 'remote'
          ? m.forRemoteBranch(label.name)
          : m.forTag(label.name);
    m.open(event, entries);
  }

  /** The column dragged lands where `target` is. */
  protected dropColumn(target: ColumnId) {
    const moved = this.moving();
    this.moving.set(null);
    if (!moved || moved === target) return;
    const columns = [...this.preferences.preferences().columns];
    const from = columns.findIndex((c) => c.id === moved);
    const to = columns.findIndex((c) => c.id === target);
    // taken out then put at the target's place: after it going right, before it going left
    const [column] = columns.splice(from, 1);
    columns.splice(to, 0, column);
    this.preferences.set('columns', columns);
  }

  /** What the history shows: its columns, the descriptions, the pictures. */
  protected columnsMenu(button: HTMLElement) {
    const p = this.preferences;
    const prefs = p.preferences();
    const toggle = (id: ColumnId): MenuEntry => {
      const shown = prefs.columns.find((c) => c.id === id)?.shown ?? true;
      return {
        label: this.titles()[id],
        checked: shown,
        run: () =>
          p.set(
            'columns',
            prefs.columns.map((c) => (c.id === id ? { ...c, shown: !shown } : c)),
          ),
      };
    };
    this.menus.openUnder(button, [
      toggle('refs'),
      toggle('graph'),
      toggle('author'),
      toggle('date'),
      toggle('sha'),
      null,
      {
        label: t('Descriptions after the summaries'),
        checked: prefs.descriptions,
        run: () => p.set('descriptions', !prefs.descriptions),
      },
      {
        label: t('Authors’ pictures on the graph'),
        checked: prefs.pictures,
        run: () => p.set('pictures', !prefs.pictures),
      },
      null,
      {
        label: t('Put the columns back as they were'),
        run: () => p.set('columns', [...DEFAULT_COLUMNS]),
      },
    ]);
  }

  @HostListener('document:keydown', ['$event'])
  protected find(event: KeyboardEvent) {
    if (!this.repository.active() || !event.ctrlKey || event.key.toLowerCase() !== 'f') return;
    // the diff's editor has a search of its own
    if ((event.target as HTMLElement).closest('.monaco-editor')) return;
    event.preventDefault();
    this.searching.set(true);
    requestAnimationFrame(() => this.searchBox()?.nativeElement.select());
  }

  /** Brings the next match forward, or the previous one; the one in front again with 0. */
  protected go(step: number) {
    const matches = this.matches();
    if (!matches.length) return;
    const at = (this.at() + step + matches.length) % matches.length;
    this.at.set(at);
    this.repository.select(matches[at]);
  }

  protected closeSearch() {
    this.searching.set(false);
    this.query.set('');
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
