// api/provisioner.js
// High-level create/delete/stop/start logic for sandbox instances.
// Validates inputs, checks uniqueness, calls k8s.js, updates SQLite.

'use strict';

const crypto = require('crypto');
const db = require('./db');
const k8s = require('./k8s');

// Readable characters for passwords — no confusing 0/O, l/1/I
const READABLE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

function generatePassword(len = 8) {
  const bytes = crypto.randomBytes(len * 2);
  return Array.from(bytes)
    .map(b => READABLE_CHARS[b % READABLE_CHARS.length])
    .slice(0, len)
    .join('');
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Validate instance name: lowercase alphanumeric + hyphens, 3-63 chars,
// must start and end with alphanumeric.
function validateName(name) {
  if (!name || typeof name !== 'string') return 'Name is required';
  if (name.length < 3) return 'Name must be at least 3 characters';
  if (name.length > 63) return 'Name must be at most 63 characters';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) {
    return 'Name must be lowercase letters/numbers with optional hyphens, start and end with alphanumeric';
  }
  return null;
}

// Find the next free NodePort in the configured range.
// Checks both SQLite (for in-db allocations) and live kubectl (for any existing).
function allocateSshPort() {
  const base = parseInt(db.getConfig('base_ssh_port') || '30100', 10);
  const max = parseInt(db.getConfig('max_ssh_port') || '31000', 10);

  const usedInDb = new Set(db.getUsedPorts());
  const usedInK8s = new Set(k8s.getAllNodePorts());
  const used = new Set([...usedInDb, ...usedInK8s]);

  for (let port = base; port <= max; port++) {
    if (!used.has(port)) return port;
  }
  throw new Error('No free SSH ports available (range exhausted)');
}

// Create a new sandbox instance: validate → provision K8s → record in DB.
function createInstance(params) {
  const {
    name,
    imageId = 'ubuntu-22.04',
    tier = 'T1',
    storage = 'S1',
    ephemeral = false,
    creatorId = null,
  } = params;

  const nameErr = validateName(name);
  if (nameErr) throw new Error(nameErr);

  const existing = db.getActiveInstance(name);
  if (existing) throw new Error(`Instance '${name}' already exists`);

  const image = db.getImage(imageId);
  if (!image) throw new Error(`Image '${imageId}' not found`);
  if (!image.enabled) throw new Error(`Image '${imageId}' is not available`);

  const tierUpper = tier.toUpperCase();
  const storageUpper = storage.toUpperCase();

  if (!k8s.TIERS[tierUpper]) throw new Error(`Invalid tier: ${tier}. Valid: T1, T2, T3`);
  if (!k8s.STORAGE[storageUpper]) throw new Error(`Invalid storage: ${storage}. Valid: S1-S5`);

  const password = generatePassword();
  const token = generateToken();
  const sshPort = allocateSshPort();
  const namespace = `sandbox-${name}`;

  // expires_at: set for 24h ephemeral instances
  let expiresAt = null;
  if (ephemeral) {
    const exp = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expiresAt = exp.toISOString().replace('T', ' ').slice(0, 19);
  }

  // Provision K8s resources
  k8s.createInstance({
    name,
    dockerImage: image.docker_image,
    tier: tierUpper,
    storage: storageUpper,
    password,
    sshPort,
    imageId,
  });

  // Record in SQLite
  const record = {
    id: name,
    creator_id: creatorId,
    token,
    image_id: imageId,
    tier: tierUpper,
    storage: storageUpper,
    ephemeral: ephemeral ? 1 : 0,
    password,
    ssh_port: sshPort,
    namespace,
    status: 'running',
    expires_at: expiresAt,
  };

  db.insertInstance(record);

  return {
    ...record,
    url: `http://${name}.nstsdc.org`,
    ssh: `nst-sandbox ssh ${name}`,
  };
}

// Destroy instance: delete K8s namespace + mark deleted in DB.
function destroyInstance(name) {
  const inst = db.getActiveInstance(name);
  if (!inst) throw new Error(`Instance '${name}' not found`);

  k8s.deleteInstance(name);
  db.markInstanceDeleted(name);
}

// Stop instance: delete pod only, preserve PVC.
function stopInstance(name) {
  const inst = db.getActiveInstance(name);
  if (!inst) throw new Error(`Instance '${name}' not found`);
  if (inst.status !== 'running') throw new Error(`Instance '${name}' is not running`);

  k8s.stopInstance(name);
  db.updateInstanceStatus(name, 'stopped');
}

// Start (resume) stopped instance: re-create pod from template.
function startInstance(name) {
  const inst = db.getActiveInstance(name);
  if (!inst) throw new Error(`Instance '${name}' not found`);
  if (inst.status === 'running') throw new Error(`Instance '${name}' is already running`);

  const image = db.getImage(inst.image_id);
  if (!image) throw new Error(`Image '${inst.image_id}' not found`);

  k8s.startInstance({
    name,
    dockerImage: image.docker_image,
    tier: inst.tier,
    storage: inst.storage,
    password: inst.password,
    sshPort: inst.ssh_port,
    imageId: inst.image_id,
  });

  db.updateInstanceStatus(name, 'running');
}

module.exports = {
  validateName,
  createInstance,
  destroyInstance,
  stopInstance,
  startInstance,
};
