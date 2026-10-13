import { Component, computed, input } from '@angular/core';

const COLORS = 8;

/** Up to two letters for a person: the first of their first and last names. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0];
  const last = words.length > 1 ? [...words[words.length - 1]][0] : '';
  return (first + last).toUpperCase();
}

/** A colour of the palette, always the same for the same person. */
export function personColor(key: string): string {
  let hash = 0;
  for (const char of key.toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return `var(--r-lane-${Math.abs(hash) % COLORS})`;
}

/** A person as a coloured disc with their initials. */
@Component({
  selector: 'app-avatar',
  template: `{{ letters() }}`,
  host: {
    '[style.--size.px]': 'size()',
    '[style.background]': 'color() ?? personColor(key() || name())',
    '[attr.title]': 'name()',
  },
  styles: `
    :host {
      flex: none;
      width: var(--size);
      height: var(--size);
      display: inline-grid;
      place-items: center;
      border-radius: 50%;
      color: var(--r-on-accent);
      font: 700 calc(var(--size) * 0.4) / 1 var(--r-font);
      letter-spacing: -0.02em;
      user-select: none;
    }
  `,
})
export class Avatar {
  readonly name = input.required<string>();
  /** What picks the colour, the name when empty (an email is steadier). */
  readonly key = input('');
  readonly color = input<string | null>(null);
  readonly size = input(28);
  protected readonly letters = computed(() => initials(this.name()));
  protected readonly personColor = personColor;
}
