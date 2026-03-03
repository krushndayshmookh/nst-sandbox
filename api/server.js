const http = require('http');
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SANDBOX_CLI = process.env.SANDBOX_CLI || '/usr/local/bin/nst-sandbox';
const ADMIN_KEY = process.env.ADMIN_KEY || 'nst-admin-2026';
const TOKEN_DIR = '/data/tokens';

// Ensure token storage exists
try { fs.mkdirSync(TOKEN_DIR, { recursive: true }); } catch {}

// Token helpers — one file per sandbox ID
function saveToken(id, tokenData) {
  fs.writeFileSync(path.join(TOKEN_DIR, `${id}.json`), JSON.stringify(tokenData));
}

function loadToken(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(TOKEN_DIR, `${id}.json`), 'utf8'));
  } catch { return null; }
}

function deleteToken(id) {
  try { fs.unlinkSync(path.join(TOKEN_DIR, `${id}.json`)); } catch {}
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

// Get auth token from header
function getToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

function isAdmin(req) {
  return getToken(req) === ADMIN_KEY;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      return res.end(JSON.stringify({ status: 'ok' }));
    }

    // List sandboxes (admin only)
    if (req.method === 'GET' && req.url === '/list') {
      if (!isAdmin(req)) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok: false, error: 'Admin access required.' }));
      }
      const out = execSync(`${SANDBOX_CLI} list`, { timeout: 30000 }).toString();
      return res.end(JSON.stringify({ ok: true, output: out }));
    }

    // Create sandbox
    if (req.method === 'POST' && req.url === '/create') {
      const data = await parseBody(req);
      const id = (data.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);

      if (!id || id.length < 3) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'Invalid ID. Use lowercase alphanumeric + hyphens, min 3 chars.' }));
      }

      // Check if already exists
      const existing = loadToken(id);
      if (existing) {
        // Sandbox exists — return saved credentials
        return res.end(JSON.stringify({
          ok: true,
          id,
          ssh: existing.ssh,
          password: existing.password,
          web: existing.web,
          token: existing.token,
          message: 'Sandbox already exists. Here are your credentials.'
        }));
      }

      console.log(`[${new Date().toISOString()}] Creating sandbox: ${id}`);
      const output = execSync(`${SANDBOX_CLI} create ${id}`, { timeout: 180000 }).toString();

      const sshMatch = output.match(/SSH:\s+(.+)/);
      const passMatch = output.match(/Pass:\s+(.+)/);
      const webMatch = output.match(/Web:\s+(.+)/);

      const token = generateToken();
      const tokenData = {
        id,
        token,
        ssh: sshMatch ? sshMatch[1].trim() : null,
        password: passMatch ? passMatch[1].trim() : null,
        web: webMatch ? webMatch[1].trim() : null,
        createdAt: new Date().toISOString()
      };
      saveToken(id, tokenData);

      res.statusCode = 201;
      return res.end(JSON.stringify({
        ok: true,
        id,
        ssh: tokenData.ssh,
        password: tokenData.password,
        web: tokenData.web,
        token,
        message: 'Your sandbox is ready! Credentials are saved locally by the CLI.'
      }));
    }

    // Delete sandbox
    if (req.method === 'DELETE' && req.url.startsWith('/sandbox/')) {
      const id = req.url.split('/sandbox/')[1].toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!id) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'Missing sandbox ID.' }));
      }

      const reqToken = getToken(req);

      // Auth: admin key OR matching sandbox token
      const existing = loadToken(id);
      if (isAdmin(req) || (existing && existing.token === reqToken)) {
        console.log(`[${new Date().toISOString()}] Deleting sandbox: ${id} (by ${isAdmin(req) ? 'admin' : 'owner'})`);
        try {
          execSync(`${SANDBOX_CLI} delete ${id}`, { timeout: 60000 });
        } catch {}
        deleteToken(id);
        return res.end(JSON.stringify({ ok: true, message: `Sandbox '${id}' deleted.` }));
      }

      res.statusCode = 403;
      return res.end(JSON.stringify({ ok: false, error: 'Invalid token. You can only delete your own sandbox.' }));
    }

    // Info
    if (req.method === 'GET' && req.url.startsWith('/info/')) {
      const id = req.url.split('/info/')[1].toLowerCase().replace(/[^a-z0-9-]/g, '');
      try {
        const out = execSync(`${SANDBOX_CLI} info ${id}`, { timeout: 15000 }).toString();
        return res.end(JSON.stringify({ ok: true, output: out }));
      } catch {
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok: false, error: `Sandbox '${id}' not found.` }));
      }
    }

    // Client CLI download (raw script)
    if (req.method === 'GET' && req.url === '/client') {
      res.setHeader('Content-Type', 'text/plain');
      try {
        const script = fs.readFileSync('/opt/nst-sandbox/nst-sandbox-client', 'utf8');
        return res.end(script);
      } catch {
        res.statusCode = 500;
        return res.end('#!/bin/bash\necho "Client script not found on server."');
      }
    }

    // Installer script (curl | bash)
    if (req.method === 'GET' && req.url === '/install') {
      res.setHeader('Content-Type', 'text/plain');
      try {
        const script = fs.readFileSync('/opt/nst-sandbox/install.sh', 'utf8');
        return res.end(script);
      } catch {
        res.statusCode = 500;
        return res.end('#!/bin/bash\necho "Installer not found on server."');
      }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found', endpoints: ['POST /create', 'DELETE /sandbox/:id', 'GET /info/:id', 'GET /list', 'GET /install', 'GET /health'] }));

  } catch (e) {
    console.error(`[${new Date().toISOString()}] Error:`, e.message);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: 'Internal server error.' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`🚀 nst-sandbox API running on port ${PORT}`);
});
