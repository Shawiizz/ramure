import { Injectable, signal } from '@angular/core';

/** Pictures are fetched at this size, twice what is shown for sharp screens. */
const SIZE = 64;

/**
 * People's pictures, by email: the one GitHub has of them (told for a repository's authors,
 * or read from their GitHub address), else Gravatar's; none for those neither has a picture
 * of (their initials show instead).
 */
@Injectable({ providedIn: 'root' })
export class GravatarService {
  /** GitHub's pictures of people, by email in lower case. */
  private readonly github = signal<ReadonlyMap<string, string>>(new Map());
  private readonly hashes = signal<ReadonlyMap<string, string>>(new Map());
  private readonly missing = signal<ReadonlySet<string>>(new Set());
  private readonly hashing = new Set<string>();

  /** The picture of whoever has `email`; null while unknown or when there is none. */
  url(email: string): string | null {
    const key = email.trim().toLowerCase();
    if (!key || this.missing().has(key)) return null;
    const known = this.github().get(key) ?? noreplyPicture(key);
    if (known) return `${known}${known.includes('?') ? '&' : '?'}s=${SIZE}`;
    const hash = this.hashes().get(key);
    if (hash) return `https://gravatar.com/avatar/${hash}?s=${SIZE}&d=404`;
    this.hash(key);
    return null;
  }

  /** The pictures GitHub has of people, by email in lower case. */
  learn(pictures: Record<string, string>) {
    this.github.update((known) => new Map([...known, ...Object.entries(pictures)]));
  }

  /** Gravatar had no picture for `email`: the initials stay. */
  notFound(email: string) {
    const key = email.trim().toLowerCase();
    this.missing.update((missing) => new Set(missing).add(key));
  }

  private async hash(key: string) {
    if (this.hashing.has(key)) return;
    this.hashing.add(key);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    this.hashes.update((hashes) => new Map(hashes).set(key, hex));
  }
}

/**
 * The picture of a GitHub account from the address GitHub gives commits made on its site:
 * `12345+login@users.noreply.github.com`, or `login@users.noreply.github.com` for older ones.
 */
function noreplyPicture(email: string): string | null {
  const found = /^(?:(\d+)\+)?([\w-]+)@users\.noreply\.github\.com$/.exec(email);
  if (!found) return null;
  const [, id, login] = found;
  return id ? `https://avatars.githubusercontent.com/u/${id}` : `https://github.com/${login}.png`;
}
