/**
 * E-SYLLAB Settings & Preferences Service
 * Manages theme (Light / Dark mode) and user notification preferences with localStorage persistence.
 */

export type ThemeMode = 'dark' | 'light';

export interface NotificationPreferences {
  deadlines: boolean;
  meetings: boolean;
  misconduct: boolean;
  general: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  deadlines: true,
  meetings: true,
  misconduct: true,
  general: true,
};

const THEME_STORAGE_KEY = 'esyllab-theme';
const NOTIF_PREFS_PREFIX = 'esyllab_notif_prefs_';

/**
 * Get current saved theme mode. Defaults to 'dark'.
 */
export function getSavedTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (err) {
    console.warn('[SettingsService] Failed to read theme from localStorage:', err);
  }
  return 'dark';
}

/**
 * Apply theme mode to document root and persist in localStorage.
 */
export function applyTheme(theme: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.classList.remove('light', 'dark', 'theme-light', 'theme-dark');
    root.classList.add(theme);
    root.classList.add(`theme-${theme}`);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem('theme', theme);
    window.dispatchEvent(new CustomEvent('esyllab_theme_change', { detail: { theme } }));
  } catch (err) {
    console.warn('[SettingsService] Failed to persist theme:', err);
  }
}

/**
 * Get notification preferences for a specific user.
 */
export function getNotificationPreferences(userId?: string): NotificationPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  const key = userId ? `${NOTIF_PREFS_PREFIX}${userId}` : `${NOTIF_PREFS_PREFIX}default`;
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        deadlines: typeof parsed.deadlines === 'boolean' ? parsed.deadlines : true,
        meetings: typeof parsed.meetings === 'boolean' ? parsed.meetings : true,
        misconduct: typeof parsed.misconduct === 'boolean' ? parsed.misconduct : true,
        general: typeof parsed.general === 'boolean' ? parsed.general : true,
      };
    }
  } catch (err) {
    console.warn('[SettingsService] Failed to read notification preferences:', err);
  }
  return { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

/**
 * Save notification preferences for a specific user and broadcast update.
 */
export function saveNotificationPreferences(userId: string | undefined, prefs: NotificationPreferences): void {
  if (typeof window === 'undefined') return;
  const key = userId ? `${NOTIF_PREFS_PREFIX}${userId}` : `${NOTIF_PREFS_PREFIX}default`;
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent('esylab_notification_update'));
    window.dispatchEvent(new CustomEvent('esyllab_preferences_update', { detail: { prefs } }));
  } catch (err) {
    console.warn('[SettingsService] Failed to save notification preferences:', err);
  }
}
