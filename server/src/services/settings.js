// Instance-wide settings stored in the `settings` table (JSON values).
// Notification settings are per household, see services/households.js.

export const SETTING_DEFAULTS = {
  requireLogin: true,
  allowRegistration: false,
  // Household that anonymous visitors see when the login requirement is off.
  anonymousHouseholdId: null,
  // File name (upload dir) of the custom website icon; null = built-in icon.
  siteIcon: null,
};

export function createSettingsStore(pool) {
  let cache = null;

  async function all() {
    if (!cache) {
      const { rows } = await pool.query('SELECT key, value FROM settings');
      cache = { ...structuredClone(SETTING_DEFAULTS) };
      for (const row of rows) {
        if (row.key in SETTING_DEFAULTS) cache[row.key] = row.value;
      }
    }
    return cache;
  }

  async function get(key) {
    return (await all())[key];
  }

  async function set(values) {
    for (const [key, value] of Object.entries(values)) {
      if (!(key in SETTING_DEFAULTS)) continue;
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    }
    cache = null;
    return all();
  }

  return { all, get, set, invalidate: () => (cache = null) };
}
