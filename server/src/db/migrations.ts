import type { Database as Db } from "better-sqlite3";

const migrations: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL,
        imap_secure INTEGER NOT NULL,
        smtp_host TEXT NOT NULL,
        smtp_port INTEGER NOT NULL,
        smtp_secure INTEGER NOT NULL,
        encrypted_password BLOB NOT NULL,
        color TEXT NOT NULL DEFAULT '#3b82f6',
        created_at INTEGER NOT NULL,
        synced_at INTEGER,
        last_error TEXT
      );

      CREATE TABLE folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        delimiter TEXT NOT NULL DEFAULT '/',
        role TEXT,
        uidvalidity INTEGER,
        uidnext INTEGER,
        highest_modseq INTEGER,
        unread_count INTEGER NOT NULL DEFAULT 0,
        total_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(account_id, path)
      );

      CREATE INDEX idx_folders_account ON folders(account_id);
      CREATE INDEX idx_folders_role ON folders(role);

      CREATE TABLE threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_normalized TEXT NOT NULL,
        last_date INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        unread_count INTEGER NOT NULL DEFAULT 0,
        has_starred INTEGER NOT NULL DEFAULT 0,
        has_attachments INTEGER NOT NULL DEFAULT 0,
        preview TEXT NOT NULL DEFAULT '',
        participants_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX idx_threads_last_date ON threads(last_date DESC);
      CREATE INDEX idx_threads_subject ON threads(subject_normalized);

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        uid INTEGER NOT NULL,
        message_id TEXT,
        in_reply_to TEXT,
        references_json TEXT NOT NULL DEFAULT '[]',
        subject TEXT NOT NULL DEFAULT '',
        from_json TEXT NOT NULL DEFAULT '[]',
        to_json TEXT NOT NULL DEFAULT '[]',
        cc_json TEXT NOT NULL DEFAULT '[]',
        bcc_json TEXT NOT NULL DEFAULT '[]',
        date INTEGER NOT NULL,
        flags_json TEXT NOT NULL DEFAULT '[]',
        unread INTEGER NOT NULL DEFAULT 1,
        starred INTEGER NOT NULL DEFAULT 0,
        size INTEGER NOT NULL DEFAULT 0,
        preview TEXT NOT NULL DEFAULT '',
        body_text TEXT,
        body_html TEXT,
        has_attachments INTEGER NOT NULL DEFAULT 0,
        UNIQUE(account_id, folder_id, uid)
      );

      CREATE INDEX idx_messages_thread ON messages(thread_id);
      CREATE INDEX idx_messages_folder ON messages(folder_id);
      CREATE INDEX idx_messages_date ON messages(date DESC);
      CREATE INDEX idx_messages_msgid ON messages(message_id);
      CREATE INDEX idx_messages_unread ON messages(unread);

      CREATE TABLE attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        content_id TEXT,
        storage_path TEXT NOT NULL
      );

      CREATE INDEX idx_attachments_message ON attachments(message_id);

      CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#94a3b8'
      );

      CREATE TABLE thread_tags (
        thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (thread_id, tag_id)
      );

      CREATE TABLE filters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        match_type TEXT NOT NULL DEFAULT 'all',
        conditions_json TEXT NOT NULL DEFAULT '[]',
        actions_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        sent_at INTEGER
      );

      CREATE INDEX idx_outbox_status ON outbox(status);

      CREATE VIRTUAL TABLE messages_fts USING fts5(
        subject,
        body,
        from_addr,
        to_addr,
        content='',
        tokenize='unicode61 remove_diacritics 2'
      );
    `,
  },
  {
    id: 2,
    sql: `
      ALTER TABLE accounts ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password';
      ALTER TABLE accounts ADD COLUMN oauth_provider TEXT;
      ALTER TABLE accounts ADD COLUMN encrypted_oauth_refresh BLOB;
    `,
  },
  {
    // Two related fixes:
    //
    // 1) The original messages_fts was created with content='' (contentless),
    //    which makes plain `DELETE FROM messages_fts WHERE rowid IN (...)`
    //    fail with "cannot DELETE from contentless fts5 table". Rebuild it
    //    as a regular FTS5 table that owns its own content.
    //
    // 2) An earlier setRead/setStarred bug used `json_set(flags_json, '$',
    //    flags_json)` which re-wraps the JSON column as a string each call.
    //    Heal any rows where flags_json is not a valid JSON array — drop
    //    them back to '[]'. The unread/starred boolean columns are still
    //    correct; the flags array just had its IMAP flag list temporarily
    //    forgotten, which the next sync will refresh.
    id: 3,
    sql: `
      DROP TABLE IF EXISTS messages_fts;

      CREATE VIRTUAL TABLE messages_fts USING fts5(
        subject,
        body,
        from_addr,
        to_addr,
        tokenize='unicode61 remove_diacritics 2'
      );

      INSERT INTO messages_fts (rowid, subject, body, from_addr, to_addr)
      SELECT
        id,
        subject,
        COALESCE(body_text, ''),
        from_json,
        to_json || ' ' || cc_json
      FROM messages;

      UPDATE messages SET flags_json = '[]'
      WHERE json_valid(flags_json) = 0
         OR json_type(flags_json) <> 'array';
    `,
  },
];

export function applyMigrations(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((r: any) => r.id),
  );
  const insert = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      insert.run(m.id, Date.now());
    })();
  }
}
