/** Who signs commits (`ramure_git::Identity`). */
export interface Identity {
  name: string;
  email: string;
}

/** A named identity to commit with, switched from the title bar. */
export interface Profile {
  id: string;
  name: string;
  identity: Identity;
}

/** Repositories opened together, in tabs. */
export interface Workspace {
  id: string;
  name: string;
  paths: string[];
}

export type Theme = 'dark' | 'light' | 'system';
/** A column of the history. */
export type ColumnId = 'refs' | 'graph' | 'message' | 'author' | 'date' | 'sha';

export interface Column {
  id: ColumnId;
  shown: boolean;
}

export const DEFAULT_COLUMNS: readonly Column[] = [
  { id: 'refs', shown: true },
  { id: 'graph', shown: true },
  { id: 'message', shown: true },
  { id: 'author', shown: true },
  { id: 'date', shown: true },
  { id: 'sha', shown: true },
];

/** The whole file with its changes marked, or the changes themselves. */
export type DiffMode = 'file' | 'diff';
/** The changes alone with a little context, inline with the whole file, or side by side. */
export type DiffLayout = 'hunks' | 'inline' | 'split';

/** How Ramure behaves, as set in the settings. */
export interface Preferences {
  theme: Theme;
  /** The tabs of the last run open again at startup. */
  reopenTabs: boolean;
  /** "3 days ago" rather than the date, in the history. */
  relativeDates: boolean;
  /** Every remote fetched this often, in minutes; never at 0. */
  autoFetchMinutes: number;
  /** Commits read for the history. */
  historyLimit: number;
  /** Diffs leave out the lines whose spaces alone changed. */
  ignoreWhitespace: boolean;
  diffMode: DiffMode;
  diffLayout: DiffLayout;
  /** Long lines of a diff wrap rather than scroll. */
  wordWrap: boolean;
  /** How far a wheel's notch scrolls the history and the diffs, the system's distance times this. */
  scrollSpeed: number;
  /** The whole interface's scale, 1 as designed. */
  zoom: number;
  /** The history's columns, in their order; the message always shows. */
  columns: Column[];
  /** The first line of a commit's description after its summary, in the history. */
  descriptions: boolean;
  /** Authors' pictures on the graph, their initials otherwise. */
  pictures: boolean;
}

export const THEMES: readonly Theme[] = ['dark', 'light', 'system'];
export const AUTO_FETCH_MINUTES: readonly number[] = [0, 5, 15, 30];
export const HISTORY_LIMITS: readonly number[] = [1000, 5000, 20000];
export const DIFF_MODES: readonly DiffMode[] = ['file', 'diff'];
export const DIFF_LAYOUTS: readonly DiffLayout[] = ['hunks', 'inline', 'split'];
export const SCROLL_SPEEDS: readonly number[] = [1, 1.5, 2.5];
/** The zoom's steps, as a browser has them. */
export const ZOOMS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  reopenTabs: true,
  relativeDates: true,
  autoFetchMinutes: 0,
  historyLimit: 5000,
  ignoreWhitespace: false,
  diffMode: 'diff',
  diffLayout: 'hunks',
  wordWrap: false,
  scrollSpeed: 1.5,
  zoom: 1,
  columns: [...DEFAULT_COLUMNS],
  descriptions: true,
  pictures: true,
};

/** Where the panels are and how big: dragged by the user, kept from run to run. */
export interface Layout {
  /** The sidebar's width and the details panel's, in px. */
  sidebar: number;
  details: number;
  /** The sidebar's sections, in their order, by key. */
  sections: string[];
  /** The height given to a section's list, by its key; a section left out is as tall as its list. */
  heights: Record<string, number>;
}

export const SECTIONS: readonly string[] = ['local', 'remote', 'tag', 'stash'];

export const DEFAULT_LAYOUT: Layout = {
  sidebar: 228,
  details: 340,
  sections: [...SECTIONS],
  heights: {},
};

/** What Ramure remembers from one run to the next. */
export interface Settings {
  profiles: Profile[];
  profileId: string | null;
  workspaces: Workspace[];
  /** The repositories open in tabs, and the one in front. */
  tabs: string[];
  activeTab: number;
  recent: string[];
  /** The sidebar's sections and groups folded away, by key. */
  collapsed: string[];
  /** The names hidden or soloed in each repository's history, by its path. */
  views: Record<string, { hidden: string[]; solo: string[] }>;
  layout: Layout;
  preferences: Preferences;
}

export const NO_SETTINGS: Settings = {
  profiles: [],
  profileId: null,
  workspaces: [],
  tabs: [],
  activeTab: 0,
  recent: [],
  collapsed: [],
  views: {},
  layout: DEFAULT_LAYOUT,
  preferences: DEFAULT_PREFERENCES,
};

/** Settings read back from disk: whatever does not fit is left out. */
export function parseSettings(value: unknown): Settings {
  if (!isRecord(value)) return NO_SETTINGS;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter(isString) : []);
  const profiles = (Array.isArray(value['profiles']) ? value['profiles'] : []).flatMap(
    (p): Profile[] => {
      if (!isRecord(p) || !isString(p['id']) || !isString(p['name'])) return [];
      const identity = isRecord(p['identity']) ? p['identity'] : {};
      return [
        {
          id: p['id'],
          name: p['name'],
          identity: {
            name: isString(identity['name']) ? identity['name'] : '',
            email: isString(identity['email']) ? identity['email'] : '',
          },
        },
      ];
    },
  );
  const workspaces = (Array.isArray(value['workspaces']) ? value['workspaces'] : []).flatMap(
    (w): Workspace[] =>
      isRecord(w) && isString(w['id']) && isString(w['name'])
        ? [{ id: w['id'], name: w['name'], paths: strings(w['paths']) }]
        : [],
  );
  const profileId = value['profileId'];
  const activeTab = value['activeTab'];
  return {
    profiles,
    profileId: isString(profileId) && profiles.some((p) => p.id === profileId) ? profileId : null,
    workspaces,
    tabs: strings(value['tabs']),
    activeTab: typeof activeTab === 'number' && Number.isInteger(activeTab) ? activeTab : 0,
    recent: strings(value['recent']),
    collapsed: strings(value['collapsed']),
    views: Object.fromEntries(
      Object.entries(isRecord(value['views']) ? value['views'] : {}).flatMap(([path, v]) =>
        isRecord(v) ? [[path, { hidden: strings(v['hidden']), solo: strings(v['solo']) }]] : [],
      ),
    ),
    layout: parseLayout(value['layout']),
    preferences: parsePreferences(value['preferences']),
  };
}

function parsePreferences(value: unknown): Preferences {
  const saved = isRecord(value) ? value : {};
  const d = DEFAULT_PREFERENCES;
  const flag = (key: string, fallback: boolean): boolean => {
    const v = saved[key];
    return typeof v === 'boolean' ? v : fallback;
  };
  const among = <T>(key: string, choices: readonly T[], fallback: T): T =>
    choices.includes(saved[key] as T) ? (saved[key] as T) : fallback;
  return {
    theme: among('theme', THEMES, d.theme),
    reopenTabs: flag('reopenTabs', d.reopenTabs),
    relativeDates: flag('relativeDates', d.relativeDates),
    autoFetchMinutes: among('autoFetchMinutes', AUTO_FETCH_MINUTES, d.autoFetchMinutes),
    historyLimit: among('historyLimit', HISTORY_LIMITS, d.historyLimit),
    ignoreWhitespace: flag('ignoreWhitespace', d.ignoreWhitespace),
    diffMode: among('diffMode', DIFF_MODES, d.diffMode),
    diffLayout: among('diffLayout', DIFF_LAYOUTS, d.diffLayout),
    wordWrap: flag('wordWrap', d.wordWrap),
    scrollSpeed: among('scrollSpeed', SCROLL_SPEEDS, d.scrollSpeed),
    zoom: among('zoom', ZOOMS, d.zoom),
    columns: parseColumns(saved['columns']),
    descriptions: flag('descriptions', d.descriptions),
    pictures: flag('pictures', d.pictures),
  };
}

function parseLayout(value: unknown): Layout {
  const saved = isRecord(value) ? value : {};
  const width = (key: string, fallback: number) => {
    const v = saved[key];
    return typeof v === 'number' && v >= 120 && v <= 1200 ? v : fallback;
  };
  const order = (Array.isArray(saved['sections']) ? saved['sections'] : []).filter(
    (k, i, all): k is string => SECTIONS.includes(k as string) && all.indexOf(k) === i,
  );
  const heights = isRecord(saved['heights']) ? saved['heights'] : {};
  return {
    sidebar: width('sidebar', DEFAULT_LAYOUT.sidebar),
    details: width('details', DEFAULT_LAYOUT.details),
    sections: [...order, ...SECTIONS.filter((k) => !order.includes(k))],
    heights: Object.fromEntries(
      Object.entries(heights).filter(
        ([k, v]) => SECTIONS.includes(k) && typeof v === 'number' && v > 0,
      ),
    ) as Record<string, number>,
  };
}

/** Saved columns: each known one once, the missing ones added at the end. */
function parseColumns(value: unknown): Column[] {
  const saved = (Array.isArray(value) ? value : []).flatMap((c): Column[] =>
    isRecord(c) && DEFAULT_COLUMNS.some((d) => d.id === c['id'])
      ? [{ id: c['id'] as ColumnId, shown: c['shown'] !== false }]
      : [],
  );
  const unique = saved.filter((c, i) => saved.findIndex((o) => o.id === c.id) === i);
  return [...unique, ...DEFAULT_COLUMNS.filter((d) => !unique.some((c) => c.id === d.id))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
