import { computed, signal } from '@angular/core';
import { FR } from './fr';

export type Language = 'en' | 'fr';
export const LANGUAGES: { id: Language; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'fr', name: 'Français' },
];

const STORAGE_KEY = 'ramure.language';

/** The English text is the key, so a missing translation shows in English. */
const current = signal<Language>(chosenLanguage());
document.documentElement.lang = current();

/** The UI's language: everything translated, dates and numbers follow it as it changes. */
export const language = current.asReadonly();

/** For dates and numbers. */
export const locale = computed(() => (current() === 'fr' ? 'fr-FR' : 'en-GB'));

function chosenLanguage(): Language {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage unavailable: follow the system
  }
  if (saved === 'en' || saved === 'fr') return saved;
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/** Switches the language, at once and for the next runs. */
export function setLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // storage unavailable: the choice lasts for this run
  }
  current.set(language);
  document.documentElement.lang = language;
}

export type Params = Record<string, string | number>;

/** `text` in the UI's language, its `{name}` placeholders filled from `params`. */
export function t(text: string, params?: Params): string {
  return translate(current(), text, params);
}

export function translate(language: Language, text: string, params?: Params): string {
  const translated = (language === 'fr' && FR[text]) || text;
  return params
    ? translated.replace(/\{(\w+)\}/g, (all, name: string) => String(params[name] ?? all))
    : translated;
}
