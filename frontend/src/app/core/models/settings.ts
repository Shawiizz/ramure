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
}

export const THEMES: readonly Theme[] = ['dark', 'light', 'system'];
export const AUTO_FETCH_MINUTES: readonly number[] = [0, 5, 15, 30];
export const HISTORY_LIMITS: readonly number[] = [1000, 5000, 20000];

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  reopenTabs: true,
  relativeDates: true,
  autoFetchMinutes: 0,
  historyLimit: 5000,
  ignoreWhitespace: false,
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
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
