import { marked } from 'marked';

/**
 * Markdown as GitHub writes it, made HTML: tables, task lists, line breaks kept. Shown
 * through `[innerHTML]`, which takes scripts and handlers out of it.
 */
export function markdown(text: string): string {
  return marked.parse(text, { gfm: true, breaks: true, async: false });
}
