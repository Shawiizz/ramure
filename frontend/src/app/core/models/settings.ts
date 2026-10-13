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

/** What Ramure remembers from one run to the next. */
export interface Settings {
  profiles: Profile[];
  profileId: string | null;
  workspaces: Workspace[];
  /** The repositories open in tabs, and the one in front. */
  tabs: string[];
  activeTab: number;
  recent: string[];
}

export const NO_SETTINGS: Settings = {
  profiles: [],
  profileId: null,
  workspaces: [],
  tabs: [],
  activeTab: 0,
  recent: [],
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
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
