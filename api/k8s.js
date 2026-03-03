// api/k8s.js
// Wrapper around kubectl commands for NST Sandbox v2.
// All functions are synchronous (execSync). Called from provisioner.js.

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', 'k8s', 'instance-template.yaml');

// ── Compute tier definitions ──────────────────────────────────────────────────
// Aligned with ARCHITECTURE.md Section 6.
const TIERS = {
  T1: { cpu_req: '100m',  cpu_lim: '500m',  mem_req: '128Mi', mem_lim: '512Mi', label: '0.5 vCPU, 512MB RAM' },
  T2: { cpu_req: '250m',  cpu_lim: '1000m', mem_req: '256Mi', mem_lim: '1Gi',   label: '1 vCPU, 1GB RAM' },
  T3: { cpu_req: '500m',  cpu_lim: '2000m', mem_req: '512Mi', mem_lim: '2Gi',   label: '2 vCPU, 2GB RAM' },
};

// ── Storage tier definitions ──────────────────────────────────────────────────
const STORAGE = {
  S1: { size: '500Mi', label: '500MB' },
  S2: { size: '1Gi',   label: '1GB' },
  S3: { size: '2Gi',   label: '2GB' },
  S4: { size: '5Gi',   label: '5GB' },
  S5: { size: '10Gi',  label: '10GB' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function kubectl(args, opts = {}) {
  return execSync(`kubectl ${args}`, {
    timeout: opts.timeout || 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  }).toString().trim();
}

// Build a K8s manifest from the instance template by substituting placeholders.
function buildManifest(params) {
  const { name, dockerImage, tier, storage, password, sshPort, imageId } = params;
  const t = TIERS[tier];
  const s = STORAGE[storage];
  if (!t) throw new Error(`Unknown tier: ${tier}`);
  if (!s) throw new Error(`Unknown storage: ${storage}`);

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return template
    .replace(/__STUDENT_ID__/g, name)
    .replace(/__IMAGE__/g, dockerImage)
    .replace(/__IMAGE_ID__/g, imageId || '')
    .replace(/__TIER__/g, tier)
    .replace(/__PASSWORD__/g, password)
    .replace(/__SSH_PORT__/g, String(sshPort))
    .replace(/__CPU_REQ__/g, t.cpu_req)
    .replace(/__CPU_LIM__/g, t.cpu_lim)
    .replace(/__MEM_REQ__/g, t.mem_req)
    .replace(/__MEM_LIM__/g, t.mem_lim)
    .replace(/__STORAGE__/g, s.size);
}

// ── Exported functions ────────────────────────────────────────────────────────

// Apply the full instance manifest (namespace + pod + pvc + services + ingress).
function createInstance(params) {
  const manifest = buildManifest(params);
  const tmpFile = `/tmp/nst-sandbox-${params.name}-${Date.now()}.yaml`;
  try {
    fs.writeFileSync(tmpFile, manifest, { mode: 0o600 });
    kubectl(`apply -f ${tmpFile}`, { timeout: 60000 });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// Delete the entire namespace (pod + PVC + services + ingress).
function deleteInstance(name) {
  try {
    kubectl(`delete namespace sandbox-${name} --grace-period=10`, { timeout: 90000 });
  } catch (err) {
    // Not found is acceptable
    if (!err.message.includes('not found')) throw err;
  }
}

// Stop: delete pod only, PVC is preserved.
function stopInstance(name) {
  try {
    kubectl(`delete pod sandbox -n sandbox-${name} --grace-period=5`, { timeout: 30000 });
  } catch (err) {
    if (!err.message.includes('not found')) throw err;
  }
}

// Start: re-apply the pod manifest only (namespace + PVC already exist, kubectl apply is idempotent).
function startInstance(params) {
  const manifest = buildManifest(params);
  const tmpFile = `/tmp/nst-sandbox-${params.name}-start-${Date.now()}.yaml`;
  try {
    fs.writeFileSync(tmpFile, manifest, { mode: 0o600 });
    // apply is safe to call again — it updates only what changed
    kubectl(`apply -f ${tmpFile}`, { timeout: 60000 });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// Get pod phase: Running | Pending | Succeeded | Failed | Unknown | notfound
function getInstanceStatus(name) {
  try {
    const phase = kubectl(
      `get pod sandbox -n sandbox-${name} -o jsonpath='{.status.phase}'`,
      { timeout: 10000 }
    );
    return phase || 'Unknown';
  } catch {
    return 'notfound';
  }
}

// Check if a namespace exists.
function namespaceExists(name) {
  try {
    kubectl(`get namespace sandbox-${name}`, { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

// Get all NodePorts currently in use across all namespaces.
function getAllNodePorts() {
  try {
    const out = kubectl(
      `get svc -A -o jsonpath='{range .items[*]}{.spec.ports[*].nodePort}{"\\n"}{end}'`,
      { timeout: 15000 }
    );
    return out.split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(n => !isNaN(n));
  } catch {
    return [];
  }
}

// List all sandbox namespaces.
function listNamespaces() {
  try {
    const out = kubectl(
      `get namespaces -l app=nst-sandbox -o jsonpath='{.items[*].metadata.name}'`,
      { timeout: 15000 }
    );
    return out.split(' ').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = {
  TIERS,
  STORAGE,
  createInstance,
  deleteInstance,
  stopInstance,
  startInstance,
  getInstanceStatus,
  namespaceExists,
  getAllNodePorts,
  listNamespaces,
};
