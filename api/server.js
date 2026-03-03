// api/server.js
// NST Sandbox v2 API server.
// Plain Node.js HTTP server — no frameworks, SQLite backend via db.js.
// Serves: REST API, Admin UI, landing page, installer, client CLI.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const db = require('./db');
const provisioner = require('./provisioner');
const jobs = require('./jobs');
const { TIERS, STORAGE } = require('./k8s');

const PORT = process.env.PORT || 3000;
const GIT_COMMIT = process.env.GIT_COMMIT || 'dev';

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ADMIN_FILE = path.join(ROOT, 'admin', 'index.html');
const CLIENT_FILE = path.join(ROOT, 'client', 'nst-sandbox');
const INSTALL_FILE = path.join(ROOT, 'client', 'install.sh');

// ── Utilities ─────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  return json(res, { ok: false, error: 'Not found' }, 404);
}

// Admin auth: X-Admin-Key header or ?key= query param.
function isAdmin(req, parsedUrl) {
  const header = req.headers['x-admin-key'] || '';
  const query = (parsedUrl.query && parsedUrl.query.key) ? parsedUrl.query.key : '';
  const provided = header || query;
  if (!provided) return false;
  const expected = db.getConfig('admin_key') || 'nst-admin-2026';
  return provided === expected;
}

// Extract Bearer token from Authorization header.
function getBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

// Serve a static file with given content type.
function serveFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // Handle preflight CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key',
    });
    return res.end();
  }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  console.log(`[${ts()}] ${method} ${pathname}`);

  try {

    // ── Health check ──────────────────────────────────────────────────────────
    if (method === 'GET' && pathname === '/health') {
      return json(res, { ok: true, status: 'ok', version: GIT_COMMIT });
    }

    // ── Landing page ──────────────────────────────────────────────────────────
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      try {
        let html = fs.readFileSync(indexPath, 'utf8');
        html = html.replace(/__GIT_COMMIT__/g, GIT_COMMIT);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(html);
      } catch {
        return notFound(res);
      }
    }

    // ── Installer script (curl -sL .../install | bash) ────────────────────────
    if (method === 'GET' && pathname === '/install') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      try { return res.end(fs.readFileSync(INSTALL_FILE, 'utf8')); }
      catch { return res.end('#!/bin/bash\necho "Installer not found on server."\n'); }
    }

    // ── Client CLI download ───────────────────────────────────────────────────
    if (method === 'GET' && pathname === '/client') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      try { return res.end(fs.readFileSync(CLIENT_FILE, 'utf8')); }
      catch { return res.end('#!/bin/bash\necho "Client not found on server."\n'); }
    }

    // ── Admin UI (single HTML file) ───────────────────────────────────────────
    if (method === 'GET' && pathname === '/admin') {
      return serveFile(res, ADMIN_FILE, 'text/html');
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    // GET /api/images — available images + tier/storage definitions
    if (method === 'GET' && pathname === '/api/images') {
      const images = db.getImages(true);
      return json(res, { ok: true, images, tiers: TIERS, storage: STORAGE });
    }

    // POST /api/instances — create a new instance
    if (method === 'POST' && pathname === '/api/instances') {
      const body = await parseBody(req);

      const name = (body.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
      const imageId = body.image || 'ubuntu-22.04';
      const tier = (body.tier || 'T1').toUpperCase();
      const storage = (body.storage || 'S1').toUpperCase();
      const ephemeral = body.ephemeral === true || body['24h'] === true;
      const creatorId = body.creator_id || null;

      try {
        const inst = provisioner.createInstance({ name, imageId, tier, storage, ephemeral, creatorId });
        console.log(`[${ts()}] Created instance: ${name} (${imageId}, ${tier}, ${storage})`);
        return json(res, {
          ok: true,
          instance: {
            name: inst.id,
            image: inst.image_id,
            tier: inst.tier,
            storage: inst.storage,
            password: inst.password,
            token: inst.token,
            ssh: inst.ssh,
            url: inst.url,
            ephemeral: inst.ephemeral === 1,
            expires_at: inst.expires_at,
          },
        }, 201);
      } catch (err) {
        return json(res, { ok: false, error: err.message }, 400);
      }
    }

    // GET /api/instances — list all instances (admin only)
    if (method === 'GET' && pathname === '/api/instances') {
      if (!isAdmin(req, parsed)) {
        return json(res, { ok: false, error: 'Admin key required' }, 403);
      }
      const instances = db.getAllInstances();
      return json(res, { ok: true, instances });
    }

    // GET /api/instances/:name
    if (method === 'GET' && /^\/api\/instances\/[a-z0-9][a-z0-9-]*[a-z0-9]?$/.test(pathname)) {
      const name = pathname.split('/').pop();
      const inst = db.getActiveInstance(name);
      if (!inst) return json(res, { ok: false, error: `Instance '${name}' not found` }, 404);
      db.updateLastAccessed(name);
      // Strip token from public response
      const { token: _token, ...safe } = inst;
      return json(res, { ok: true, instance: safe });
    }

    // DELETE /api/instances/:name
    if (method === 'DELETE' && /^\/api\/instances\/[a-z0-9][a-z0-9-]*[a-z0-9]?$/.test(pathname)) {
      const name = pathname.split('/').pop();
      const inst = db.getActiveInstance(name);
      if (!inst) return json(res, { ok: false, error: `Instance '${name}' not found` }, 404);

      const token = getBearerToken(req);
      if (!isAdmin(req, parsed) && inst.token !== token) {
        return json(res, { ok: false, error: 'Invalid token. You can only delete your own instance.' }, 403);
      }

      try {
        provisioner.destroyInstance(name);
        console.log(`[${ts()}] Deleted instance: ${name}`);
        return json(res, { ok: true, message: `Instance '${name}' deleted.` });
      } catch (err) {
        return json(res, { ok: false, error: err.message }, 500);
      }
    }

    // POST /api/instances/:name/stop
    if (method === 'POST' && /^\/api\/instances\/[a-z0-9][a-z0-9-]*[a-z0-9]?\/stop$/.test(pathname)) {
      const parts = pathname.split('/');
      const name = parts[3];
      const inst = db.getActiveInstance(name);
      if (!inst) return json(res, { ok: false, error: `Instance '${name}' not found` }, 404);

      const token = getBearerToken(req);
      if (!isAdmin(req, parsed) && inst.token !== token) {
        return json(res, { ok: false, error: 'Invalid token.' }, 403);
      }

      try {
        provisioner.stopInstance(name);
        return json(res, { ok: true, message: `Instance '${name}' stopped.` });
      } catch (err) {
        return json(res, { ok: false, error: err.message }, 400);
      }
    }

    // POST /api/instances/:name/start
    if (method === 'POST' && /^\/api\/instances\/[a-z0-9][a-z0-9-]*[a-z0-9]?\/start$/.test(pathname)) {
      const parts = pathname.split('/');
      const name = parts[3];
      const inst = db.getActiveInstance(name);
      if (!inst) return json(res, { ok: false, error: `Instance '${name}' not found` }, 404);

      const token = getBearerToken(req);
      if (!isAdmin(req, parsed) && inst.token !== token) {
        return json(res, { ok: false, error: 'Invalid token.' }, 403);
      }

      try {
        provisioner.startInstance(name);
        return json(res, { ok: true, message: `Instance '${name}' started.` });
      } catch (err) {
        return json(res, { ok: false, error: err.message }, 400);
      }
    }

    // POST /api/instances/:name/accessed — bastion notifies on successful auth
    if (method === 'POST' && /^\/api\/instances\/[a-z0-9][a-z0-9-]*[a-z0-9]?\/accessed$/.test(pathname)) {
      const name = pathname.split('/')[3];
      db.updateLastAccessed(name);
      return json(res, { ok: true });
    }

    // ── Admin API (all require admin key) ─────────────────────────────────────

    if (pathname.startsWith('/admin/api/')) {
      if (!isAdmin(req, parsed)) {
        return json(res, { ok: false, error: 'Admin key required' }, 403);
      }

      // GET /admin/api/stats
      if (method === 'GET' && pathname === '/admin/api/stats') {
        const stats = db.getStats();
        return json(res, { ok: true, stats });
      }

      // GET /admin/api/instances
      if (method === 'GET' && pathname === '/admin/api/instances') {
        const instances = db.getAllInstances(true);
        return json(res, { ok: true, instances });
      }

      // DELETE /admin/api/instances/:name
      if (method === 'DELETE' && /^\/admin\/api\/instances\/[a-z0-9][a-z0-9-]*[a-z0-9]?$/.test(pathname)) {
        const name = pathname.split('/').pop();
        try {
          provisioner.destroyInstance(name);
          return json(res, { ok: true, message: `Instance '${name}' deleted.` });
        } catch (err) {
          return json(res, { ok: false, error: err.message }, 400);
        }
      }

      // DELETE /admin/api/instances — bulk delete
      if (method === 'DELETE' && pathname === '/admin/api/instances') {
        const body = await parseBody(req);
        let names = [];
        if (body.filter === 'all') {
          names = db.getAllInstances().map(i => i.id);
        } else if (Array.isArray(body.names)) {
          names = body.names;
        }

        const results = [];
        for (const name of names) {
          try {
            provisioner.destroyInstance(name);
            results.push({ name, ok: true });
          } catch (err) {
            results.push({ name, ok: false, error: err.message });
          }
        }
        return json(res, { ok: true, results });
      }

      // POST /admin/api/purge — purge inactive instances
      if (method === 'POST' && pathname === '/admin/api/purge') {
        const body = await parseBody(req);
        const days = parseInt(body.days || db.getConfig('purge_inactive_days') || '30', 10);
        const inactive = db.getInactiveInstances(days);

        const results = [];
        for (const inst of inactive) {
          try {
            provisioner.destroyInstance(inst.id);
            results.push({ name: inst.id, ok: true });
          } catch (err) {
            results.push({ name: inst.id, ok: false, error: err.message });
          }
        }
        return json(res, { ok: true, purged: results.length, results });
      }

      // GET /admin/api/images
      if (method === 'GET' && pathname === '/admin/api/images') {
        return json(res, { ok: true, images: db.getImages(false) });
      }

      // POST /admin/api/images — add image
      if (method === 'POST' && pathname === '/admin/api/images') {
        const body = await parseBody(req);
        try {
          db.insertImage({
            id: body.id,
            name: body.name,
            description: body.description || '',
            docker_image: body.docker_image,
            ports: body.ports || '[22]',
            default_tier: body.default_tier || 'T1',
            enabled: body.enabled !== false ? 1 : 0,
          });
          return json(res, { ok: true });
        } catch (err) {
          return json(res, { ok: false, error: err.message }, 400);
        }
      }

      // PUT /admin/api/images/:id — update image
      if (method === 'PUT' && /^\/admin\/api\/images\/.+$/.test(pathname)) {
        const id = pathname.split('/').pop();
        const body = await parseBody(req);
        db.updateImage(id, body);
        return json(res, { ok: true });
      }

      // DELETE /admin/api/images/:id — disable image
      if (method === 'DELETE' && /^\/admin\/api\/images\/.+$/.test(pathname)) {
        const id = pathname.split('/').pop();
        db.deleteImage(id);
        return json(res, { ok: true });
      }

      // GET /admin/api/config
      if (method === 'GET' && pathname === '/admin/api/config') {
        return json(res, { ok: true, config: db.getAllConfig() });
      }

      // PUT /admin/api/config
      if (method === 'PUT' && pathname === '/admin/api/config') {
        const body = await parseBody(req);
        db.updateConfigBulk(body);
        return json(res, { ok: true });
      }

      return notFound(res);
    }

    return notFound(res);

  } catch (err) {
    console.error(`[${ts()}] Error handling ${method} ${pathname}:`, err.message);
    if (!res.headersSent) {
      json(res, { ok: false, error: 'Internal server error' }, 500);
    }
  }
});

// Start background jobs
jobs.start();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${ts()}] NST Sandbox API v2 running on port ${PORT} (commit: ${GIT_COMMIT})`);
});
