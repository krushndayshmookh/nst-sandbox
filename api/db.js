// api/db.js
// SQLite database setup and query helpers for NST Sandbox v2.
// Uses better-sqlite3 (synchronous API — suitable for single-process Node.js).

'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || '/data/sandbox.db';

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS images (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    docker_image TEXT NOT NULL,
    ports        TEXT DEFAULT '[22]',
    default_tier TEXT DEFAULT 'T1',
    enabled      INTEGER DEFAULT 1,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS instances (
    id           TEXT PRIMARY KEY,
    creator_id   TEXT,
    token        TEXT NOT NULL,
    image_id     TEXT NOT NULL REFERENCES images(id),
    tier         TEXT NOT NULL,
    storage      TEXT NOT NULL,
    ephemeral    INTEGER DEFAULT 0,
    password     TEXT NOT NULL,
    ssh_port     INTEGER,
    namespace    TEXT NOT NULL,
    status       TEXT DEFAULT 'running',
    created_at   TEXT DEFAULT (datetime('now')),
    last_accessed TEXT,
    expires_at   TEXT,
    deleted_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ── Seed default data ─────────────────────────────────────────────────────────

const seedImages = db.transaction(() => {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO images (id, name, description, docker_image, ports, default_tier)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    'ubuntu-22.04',
    'Ubuntu 22.04 LTS',
    'Minimal Ubuntu 22.04 with SSH and sudo. EC2-style environment.',
    'localhost:30500/nst-sandbox-ubuntu:latest',
    '[22]',
    'T1'
  );

  insert.run(
    'alpine-web',
    'Alpine Web Sandbox',
    'Alpine Linux with nginx, Node.js, git, and SSH. Great for web projects.',
    'localhost:30500/nst-sandbox-alpine:latest',
    '[22, 80]',
    'T1'
  );
});

const seedConfig = db.transaction(() => {
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)
  `);
  upsert.run('admin_key', process.env.ADMIN_KEY || 'nst-admin-2026');
  upsert.run('purge_inactive_days', '30');
  upsert.run('max_instances_per_creator', '5');
  upsert.run('base_ssh_port', '30100');
  upsert.run('max_ssh_port', '31000');
});

seedImages();
seedConfig();

// ── Config helpers ────────────────────────────────────────────────────────────

function getConfig(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

function getAllConfig() {
  return db.prepare('SELECT key, value FROM config').all();
}

function updateConfigBulk(pairs) {
  const upsert = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) upsert.run(key, String(value));
  });
  tx(Object.entries(pairs));
}

// ── Image helpers ─────────────────────────────────────────────────────────────

function getImages(enabledOnly = true) {
  if (enabledOnly) {
    return db.prepare('SELECT * FROM images WHERE enabled = 1 ORDER BY id').all();
  }
  return db.prepare('SELECT * FROM images ORDER BY id').all();
}

function getImage(id) {
  return db.prepare('SELECT * FROM images WHERE id = ?').get(id);
}

function insertImage(img) {
  return db.prepare(`
    INSERT INTO images (id, name, description, docker_image, ports, default_tier, enabled)
    VALUES (@id, @name, @description, @docker_image, @ports, @default_tier, @enabled)
  `).run(img);
}

function updateImage(id, fields) {
  const allowed = ['name', 'description', 'docker_image', 'ports', 'default_tier', 'enabled'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return;
  const sets = updates.map(([k]) => `${k} = ?`).join(', ');
  const values = updates.map(([, v]) => v);
  db.prepare(`UPDATE images SET ${sets} WHERE id = ?`).run(...values, id);
}

function deleteImage(id) {
  db.prepare('UPDATE images SET enabled = 0 WHERE id = ?').run(id);
}

// ── Instance helpers ──────────────────────────────────────────────────────────

function getInstance(name) {
  return db.prepare('SELECT * FROM instances WHERE id = ?').get(name);
}

function getActiveInstance(name) {
  return db.prepare("SELECT * FROM instances WHERE id = ? AND status != 'deleted'").get(name);
}

function getAllInstances(includeDeleted = false) {
  if (includeDeleted) {
    return db.prepare('SELECT * FROM instances ORDER BY created_at DESC').all();
  }
  return db.prepare("SELECT * FROM instances WHERE status != 'deleted' ORDER BY created_at DESC").all();
}

function insertInstance(inst) {
  return db.prepare(`
    INSERT INTO instances
      (id, creator_id, token, image_id, tier, storage, ephemeral, password, ssh_port,
       namespace, status, expires_at)
    VALUES
      (@id, @creator_id, @token, @image_id, @tier, @storage, @ephemeral, @password, @ssh_port,
       @namespace, @status, @expires_at)
  `).run(inst);
}

function updateInstanceStatus(name, status) {
  db.prepare("UPDATE instances SET status = ? WHERE id = ?").run(status, name);
}

function markInstanceDeleted(name) {
  db.prepare(`
    UPDATE instances SET status = 'deleted', deleted_at = datetime('now') WHERE id = ?
  `).run(name);
}

function updateLastAccessed(name) {
  db.prepare("UPDATE instances SET last_accessed = datetime('now') WHERE id = ?").run(name);
}

function getExpiredInstances() {
  return db.prepare(`
    SELECT * FROM instances
    WHERE ephemeral = 1
      AND expires_at IS NOT NULL
      AND expires_at < datetime('now')
      AND status != 'deleted'
  `).all();
}

function getInactiveInstances(days) {
  return db.prepare(`
    SELECT * FROM instances
    WHERE status != 'deleted'
      AND (
        last_accessed < datetime('now', '-' || ? || ' days')
        OR (last_accessed IS NULL AND created_at < datetime('now', '-' || ? || ' days'))
      )
  `).all(days, days);
}

function getStats() {
  const total = db.prepare("SELECT COUNT(*) as n FROM instances WHERE status != 'deleted'").get().n;
  const byImage = db.prepare(`
    SELECT image_id, COUNT(*) as n FROM instances WHERE status != 'deleted' GROUP BY image_id
  `).all();
  const byTier = db.prepare(`
    SELECT tier, COUNT(*) as n FROM instances WHERE status != 'deleted' GROUP BY tier
  `).all();
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as n FROM instances GROUP BY status
  `).all();
  return { total, byImage, byTier, byStatus };
}

// ── Used NodePorts ────────────────────────────────────────────────────────────

function getUsedPorts() {
  return db.prepare("SELECT ssh_port FROM instances WHERE ssh_port IS NOT NULL AND status != 'deleted'")
    .all()
    .map(r => r.ssh_port);
}

module.exports = {
  db,
  getConfig, setConfig, getAllConfig, updateConfigBulk,
  getImages, getImage, insertImage, updateImage, deleteImage,
  getInstance, getActiveInstance, getAllInstances,
  insertInstance, updateInstanceStatus, markInstanceDeleted,
  updateLastAccessed, getExpiredInstances, getInactiveInstances,
  getStats, getUsedPorts,
};
