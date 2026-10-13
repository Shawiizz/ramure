import { Injectable, signal } from '@angular/core';

/** Pictures are fetched at this size, twice what is shown for sharp screens. */
const SIZE = 64;

/**
 * People's Gravatar pictures, by email: their address once the email's hash is known, and
 * none for those Gravatar has no picture of (their initials show instead).
 */
@Injectable({ providedIn: 'root' })
export class GravatarService {
  private readonly hashes = signal<ReadonlyMap<string, string>>(new Map());
  private readonly missing = signal<ReadonlySet<string>>(new Set());
  private readonly hashing = new Set<string>();

  /** The picture of whoever has `email`; null while unknown or when there is none. */
  url(email: string): string | null {
    const key = email.trim().toLowerCase();
    if (!key || this.missing().has(key)) return null;
    const hash = this.hashes().get(key);
    if (hash) return `https://gravatar.com/avatar/${hash}?s=${SIZE}&d=404`;
    this.hash(key);
    return null;
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
