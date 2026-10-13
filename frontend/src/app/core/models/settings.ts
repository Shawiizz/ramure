/** Who signs commits, and with which key (`ramure_git::Identity`). */
export interface Identity {
  name: string;
  email: string;
  signing?: Signing;
}

/** The kind of key commits are signed with. */
export type SigningFormat = 'ssh' | 'openpgp';

/** The key commits and tags are signed with, and what it signs (`ramure_git::Signing`). */
export interface Signing {
  format: SigningFormat;
  /** A GPG key's id, or an ssh key's file. */
  key: string;
  /** The program signing; `ssh-keygen` or `gpg` when empty. */
  program: string;
  commits: boolean;
  tags: boolean;
}

/** A profile's signing: a key, or none. */
export type ProfileSigning = Omit<Signing, 'format'> & { format: SigningFormat | 'none' };

export const NO_SIGNING: ProfileSigning = {
  format: 'none',
  key: '',
  program: '',
  commits: true,
  tags: true,
};

/** A named identity to commit with, switched from the title bar. */
export interface Profile {
  id: string;
  name: string;
  identity: Identity;
  signing: ProfileSigning;
}

/** Repositories opened together, in tabs. */
export interface Workspace {
  id: string;
  name: string;
  paths: string[];
}

export type Theme = 'dark' | 'light' | 'system';
/** The colour of the buttons, the selections and the graph's main lane. */
export type Accent = 'blue' | 'violet' | 'green' | 'orange' | 'neutral';
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

/** How a pull joins the upstream's commits to the branch's own (`ramure_git::actions::Pull`). */
export type PullMode = 'merge' | 'fastForward' | 'rebase';

/** The shell a terminal opens: the system's own choice, or one asked for. */
export type TerminalShell = 'auto' | 'powershell' | 'pwsh' | 'cmd' | 'gitBash' | 'wsl';
export type CursorStyle = 'bar' | 'block' | 'underline';

/** The whole file with its changes marked, or the changes themselves. */
export type DiffMode = 'file' | 'diff';
/** The changes alone with a little context, inline with the whole file, or side by side. */
export type DiffLayout = 'hunks' | 'inline' | 'split';

/** How Ramure behaves, as set in the settings. */
export interface Preferences {
  theme: Theme;
  accent: Accent;
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
  /** What the Pull button does. */
  pull: PullMode;
  /** Changed files in their folders, rather than one list of paths. */
  fileTree: boolean;
  /** The font of the diffs, the blame and the editor; the app's own when empty. */
  editorFont: string;
  editorFontSize: number;
  tabSize: number;
  lineNumbers: boolean;
  /** Code coloured as its language is. */
  syntax: boolean;
  terminalShell: TerminalShell;
  /** The terminal's font; the editor's when empty. */
  terminalFont: string;
  terminalFontSize: number;
  terminalLineHeight: number;
  cursorStyle: CursorStyle;
  /** The terminal dims while another part of the window has the keys. */
  dimTerminal: boolean;
  /** Older commits read as the history is scrolled to its end. */
  lazyHistory: boolean;
  /** A fetch drops the remote branches deleted on their remote. */
  prune: boolean;
  /** The command opening a file or a repository in the user's editor. */
  editor: string;
  /** The global git identity follows the profile in use, for git run outside Ramure. */
  syncGitConfig: boolean;
  /** The private key git signs in to ssh remotes with; ssh's own choice when empty. */
  sshKey: string;
  /** The folder the last repository was cloned or made in, offered for the next. */
  cloneFolder: string;
}

export const THEMES: readonly Theme[] = ['dark', 'light', 'system'];
export const ACCENTS: readonly Accent[] = ['blue', 'violet', 'green', 'orange', 'neutral'];
export const AUTO_FETCH_MINUTES: readonly number[] = [0, 5, 15, 30];
export const HISTORY_LIMITS: readonly number[] = [1000, 5000, 20000];
export const DIFF_MODES: readonly DiffMode[] = ['file', 'diff'];
export const DIFF_LAYOUTS: readonly DiffLayout[] = ['hunks', 'inline', 'split'];
export const FONT_SIZES: readonly number[] = [11, 12, 12.5, 13, 14, 15, 16];
export const TAB_SIZES: readonly number[] = [2, 4, 8];
export const TERMINAL_SHELLS: readonly TerminalShell[] = [
  'auto',
  'powershell',
  'pwsh',
  'cmd',
  'gitBash',
  'wsl',
];
export const LINE_HEIGHTS: readonly number[] = [1, 1.15, 1.3];
export const CURSOR_STYLES: readonly CursorStyle[] = ['bar', 'block', 'underline'];
/** Editors often installed, by the command that opens them. */
export const EDITORS: readonly { command: string; name: string }[] = [
  { command: 'code', name: 'Visual Studio Code' },
  { command: 'cursor', name: 'Cursor' },
  { command: 'zed', name: 'Zed' },
  { command: 'subl', name: 'Sublime Text' },
  { command: 'notepad++', name: 'Notepad++' },
  { command: 'idea', name: 'IntelliJ IDEA' },
];

/** The name of the editor `command` opens, the command itself when it is not a known one. */
export function editorName(command: string): string {
  return EDITORS.find((e) => e.command === command)?.name ?? command;
}

export const PULL_MODES: readonly PullMode[] = ['merge', 'fastForward', 'rebase'];
export const SCROLL_SPEEDS: readonly number[] = [1, 1.5, 2.5];
/** The zoom's steps, as a browser has them. */
export const ZOOMS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  accent: 'blue',
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
  pull: 'merge',
  fileTree: false,
  editorFont: '',
  editorFontSize: 12.5,
  tabSize: 4,
  lineNumbers: true,
  syntax: true,
  terminalShell: 'auto',
  terminalFont: '',
  terminalFontSize: 12.5,
  terminalLineHeight: 1.15,
  cursorStyle: 'bar',
  dimTerminal: true,
  lazyHistory: true,
  prune: true,
  editor: 'code',
  syncGitConfig: false,
  sshKey: '',
  cloneFolder: '',
};

/** Where the panels are and how big: dragged by the user, kept from run to run. */
export interface Layout {
  /** The sidebar's width and the details panel's, in px. */
  sidebar: number;
  details: number;
  /** The most a commit's message takes of the details panel, in px: past it, it scrolls. */
  message: number;
  /** The terminal's height under the history, in px. */
  terminal: number;
  /** The sidebar's sections, in their order, by key. */
  sections: string[];
  /** The height given to a section's list, by its key; a section left out is as tall as its list. */
  heights: Record<string, number>;
}

/** A commit's message is never given less than this. */
export const MIN_MESSAGE = 60;
/** Nor the terminal. */
export const MIN_TERMINAL = 100;

export const SECTIONS: readonly string[] = ['local', 'remote', 'tag', 'stash'];

export const DEFAULT_LAYOUT: Layout = {
  sidebar: 228,
  details: 340,
  message: 220,
  terminal: 260,
  sections: [...SECTIONS],
  heights: {},
};

/** What Ramure remembers from one run to the next. */
export interface Settings {
  profiles: Profile[];
  profileId: string | null;
  workspaces: Workspace[];
  /** The workspace whose tabs are open, named in the title bar. */
  workspaceId: string | null;
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
  workspaceId: null,
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
          signing: parseSigning(p['signing']),
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
  const workspaceId = value['workspaceId'];
  const activeTab = value['activeTab'];
  return {
    profiles,
    profileId: isString(profileId) && profiles.some((p) => p.id === profileId) ? profileId : null,
    workspaces,
    workspaceId:
      isString(workspaceId) && workspaces.some((w) => w.id === workspaceId) ? workspaceId : null,
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

function parseSigning(value: unknown): ProfileSigning {
  const saved = isRecord(value) ? value : {};
  const format = saved['format'];
  return {
    format: format === 'ssh' || format === 'openpgp' ? format : 'none',
    key: isString(saved['key']) ? saved['key'] : '',
    program: isString(saved['program']) ? saved['program'] : '',
    commits: saved['commits'] !== false,
    tags: saved['tags'] !== false,
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
  /** A font's name: letters, digits, spaces, dots and dashes. */
  const font = (key: string): string => {
    const v = saved[key];
    return typeof v === 'string' && /^[\w .-]{0,64}$/.test(v) ? v.trim() : '';
  };
  return {
    theme: among('theme', THEMES, d.theme),
    accent: among('accent', ACCENTS, d.accent),
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
    pull: among('pull', PULL_MODES, d.pull),
    fileTree: flag('fileTree', d.fileTree),
    editorFont: font('editorFont'),
    editorFontSize: among('editorFontSize', FONT_SIZES, d.editorFontSize),
    tabSize: among('tabSize', TAB_SIZES, d.tabSize),
    lineNumbers: flag('lineNumbers', d.lineNumbers),
    syntax: flag('syntax', d.syntax),
    terminalShell: among('terminalShell', TERMINAL_SHELLS, d.terminalShell),
    terminalFont: font('terminalFont'),
    terminalFontSize: among('terminalFontSize', FONT_SIZES, d.terminalFontSize),
    terminalLineHeight: among('terminalLineHeight', LINE_HEIGHTS, d.terminalLineHeight),
    cursorStyle: among('cursorStyle', CURSOR_STYLES, d.cursorStyle),
    dimTerminal: flag('dimTerminal', d.dimTerminal),
    lazyHistory: flag('lazyHistory', d.lazyHistory),
    prune: flag('prune', d.prune),
    editor: isString(saved['editor']) && saved['editor'].trim() ? saved['editor'].trim() : d.editor,
    syncGitConfig: flag('syncGitConfig', d.syncGitConfig),
    sshKey: isString(saved['sshKey']) ? saved['sshKey'] : d.sshKey,
    cloneFolder: isString(saved['cloneFolder']) ? saved['cloneFolder'] : d.cloneFolder,
  };
}

function parseLayout(value: unknown): Layout {
  const saved = isRecord(value) ? value : {};
  const size = (key: string, min: number, fallback: number) => {
    const v = saved[key];
    return typeof v === 'number' && v >= min && v <= 1200 ? v : fallback;
  };
  const order = (Array.isArray(saved['sections']) ? saved['sections'] : []).filter(
    (k, i, all): k is string => SECTIONS.includes(k as string) && all.indexOf(k) === i,
  );
  const heights = isRecord(saved['heights']) ? saved['heights'] : {};
  return {
    sidebar: size('sidebar', 120, DEFAULT_LAYOUT.sidebar),
    details: size('details', 120, DEFAULT_LAYOUT.details),
    message: size('message', MIN_MESSAGE, DEFAULT_LAYOUT.message),
    terminal: size('terminal', MIN_TERMINAL, DEFAULT_LAYOUT.terminal),
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
