-- Open DataRoom schema. One D1 per deployed app; the database boundary is the
-- tenant boundary, so there is no org column anywhere.

-- UUID default so a direct insert still gets a UUID primary key (the API
-- supplies crypto.randomUUID(); this covers everything else).
-- Reused verbatim on every table that wants a UUID id.

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY DEFAULT (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS datarooms (
  id TEXT PRIMARY KEY DEFAULT (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single-level folders inside a data room. Documents attach to the room and
-- optionally to one folder; folder_id NULL means "room home".
-- shortcut: one folder level; add parent_id here if nested trees are ever needed.
CREATE TABLE IF NOT EXISTS dataroom_folders (
  id TEXT PRIMARY KEY DEFAULT (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  dataroom_id TEXT NOT NULL REFERENCES datarooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_folders_room ON dataroom_folders(dataroom_id, position);

CREATE TABLE IF NOT EXISTS dataroom_documents (
  dataroom_id TEXT NOT NULL REFERENCES datarooms(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES dataroom_folders(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (dataroom_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_room_docs_doc ON dataroom_documents(document_id);

-- A share link. The id IS the public token (72 bits of randomness, base62),
-- so possession of the URL is possession of the link. Exactly one of
-- document_id / dataroom_id is set.
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  dataroom_id TEXT REFERENCES datarooms(id) ON DELETE CASCADE,
  require_email INTEGER NOT NULL DEFAULT 1,
  -- SHA-256 hex of the passcode; empty string = no passcode.
  passcode_hash TEXT NOT NULL DEFAULT '',
  -- Whitespace/comma-separated emails or @domains. Non-empty allow_list means
  -- ONLY these may enter (and implies the email gate). deny_list wins.
  allow_list TEXT NOT NULL DEFAULT '',
  deny_list TEXT NOT NULL DEFAULT '',
  -- Overlay the viewer's email diagonally on every page (deterrent, not DRM).
  watermark INTEGER NOT NULL DEFAULT 0,
  -- Dispatch a task to the org's agent on each new visit. Default OFF: every
  -- notification costs the org one agent turn, so it is opt-in per link.
  notify INTEGER NOT NULL DEFAULT 0,
  -- Text the viewer must accept before entering; empty = no agreement gate.
  agreement_text TEXT NOT NULL DEFAULT '',
  allow_download INTEGER NOT NULL DEFAULT 0,
  -- ISO datetime after which the link answers "expired"; NULL = never.
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((document_id IS NULL) <> (dataroom_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_links_document ON links(document_id);
CREATE INDEX IF NOT EXISTS idx_links_dataroom ON links(dataroom_id);

-- One visit = one person opening a link (after passing its gates).
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY DEFAULT (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Set when the viewer accepted the link's agreement text at entry.
  agreed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_link ON visits(link_id, started_at);
CREATE INDEX IF NOT EXISTS idx_visits_email ON visits(email);

-- One document view = one document opened within a visit. Reading time and
-- progress accumulate here (and per page below) as the viewer beacons.
CREATE TABLE IF NOT EXISTS document_views (
  id TEXT PRIMARY KEY DEFAULT (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  total_seconds REAL NOT NULL DEFAULT 0,
  max_page INTEGER NOT NULL DEFAULT 0,
  downloaded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_views_visit ON document_views(visit_id);
CREATE INDEX IF NOT EXISTS idx_views_document ON document_views(document_id, started_at);

CREATE TABLE IF NOT EXISTS page_views (
  view_id TEXT NOT NULL REFERENCES document_views(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  seconds REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (view_id, page)
);

-- Workspace branding shown on the public viewer. Singleton row.
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT '',
  logo_key TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO settings (id) VALUES (1);
