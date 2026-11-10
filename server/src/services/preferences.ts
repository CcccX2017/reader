import type { Db } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';

/** Account-wide reader and preference settings. The device chooses whether to use the row. */
export interface PreferenceDocument {
  app: Record<string, unknown>;
  theme: Record<string, unknown>;
  media: Record<string, unknown>;
  playback: Record<string, unknown>;
  /** `local` means the account stopped following this row. Absent means account. */
  place: 'local' | 'account';
  updatedAt: number;
}

const MAX_DOCUMENT = 65_536;

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${name} must be an object`);
  return value as Record<string, unknown>;
}

/** The body a client may store. Anything else is a 400, and a huge document is refused. */
export function preferenceDocument(body: unknown): PreferenceDocument {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('preferences must be an object');
  const raw = body as Record<string, unknown>;
  const updatedAt = raw.updatedAt;
  if (typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    throw badRequest('updatedAt must be a non-negative integer');
  }
  if (raw.place !== undefined && raw.place !== 'local' && raw.place !== 'account') {
    throw badRequest('place must be local or account');
  }
  const document: PreferenceDocument = {
    app: asObject(raw.app, 'app'),
    theme: asObject(raw.theme, 'theme'),
    media: asObject(raw.media, 'media'),
    playback: asObject(raw.playback, 'playback'),
    place: raw.place === 'local' ? 'local' : 'account',
    updatedAt,
  };
  if (JSON.stringify(document).length > MAX_DOCUMENT) throw badRequest('preferences are too large', 'PAYLOAD_TOO_LARGE');
  return document;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stored(row: { document: string; updated_at: number } | undefined): PreferenceDocument | null {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.document) as Partial<PreferenceDocument>;
    return {
      app: record(parsed.app),
      theme: record(parsed.theme),
      media: record(parsed.media),
      playback: record(parsed.playback),
      place: parsed.place === 'local' ? 'local' : 'account',
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export class PreferencesService {
  constructor(private readonly db: Db) {}

  get(userId: string): PreferenceDocument | null {
    return stored(this.db.get('SELECT document, updated_at FROM user_preferences WHERE user_id = ?', userId));
  }

  /**
   * Last write wins. An older `updatedAt` leaves the stored row in place and
   * returns that row, so the client can adopt it instead of keeping a copy the
   * account has already moved past.
   */
  save(userId: string, document: PreferenceDocument): PreferenceDocument {
    const body = JSON.stringify({
      app: document.app,
      theme: document.theme,
      media: document.media,
      playback: document.playback,
      place: document.place,
    });
    this.db.run(
      `INSERT INTO user_preferences (user_id, document, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at
       WHERE excluded.updated_at >= user_preferences.updated_at`,
      userId,
      body,
      document.updatedAt,
    );
    return this.get(userId) ?? document;
  }
}
