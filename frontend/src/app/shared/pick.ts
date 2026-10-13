import { open } from '@tauri-apps/plugin-dialog';
import { t } from '../core/i18n/i18n';

/** Asks for a folder holding a repository; null when the user gives up. */
export async function pickRepository(): Promise<string | null> {
  const path = await open({ directory: true, title: t('Open a repository') });
  return typeof path === 'string' ? path : null;
}
