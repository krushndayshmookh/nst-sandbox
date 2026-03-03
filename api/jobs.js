// api/jobs.js
// Background jobs running in the API process via setInterval.
// 1. Expiry sweep (every 5 min): delete 24h instances past expires_at.
// 2. Status sync (every 1 min): check pod phases, update SQLite status.

'use strict';

const db = require('./db');
const k8s = require('./k8s');

function ts() {
  return new Date().toISOString();
}

// Delete all 24h instances that have passed their expires_at timestamp.
function runExpiryCheck() {
  const expired = db.getExpiredInstances();
  if (expired.length === 0) return;

  console.log(`[${ts()}] [jobs] Expiry check: ${expired.length} expired instance(s)`);

  for (const inst of expired) {
    try {
      k8s.deleteInstance(inst.id);
      db.markInstanceDeleted(inst.id);
      console.log(`[${ts()}] [jobs] Deleted expired instance: ${inst.id}`);
    } catch (err) {
      console.error(`[${ts()}] [jobs] Failed to delete expired instance '${inst.id}':`, err.message);
    }
  }
}

// Check actual pod phase for all active instances and sync SQLite status.
// Maps: Running→running, notfound+running→stopped, others ignored.
function runStatusSync() {
  const instances = db.getAllInstances();

  for (const inst of instances) {
    try {
      const phase = k8s.getInstanceStatus(inst.id);
      let newStatus = inst.status;

      if (phase === 'Running') {
        newStatus = 'running';
      } else if (phase === 'notfound' && inst.status === 'running') {
        // Pod is gone but DB says running — mark stopped
        newStatus = 'stopped';
      } else if (phase === 'Pending') {
        newStatus = 'running'; // still provisioning, keep as running
      }

      if (newStatus !== inst.status) {
        db.updateInstanceStatus(inst.id, newStatus);
        console.log(`[${ts()}] [jobs] Status sync: ${inst.id} ${inst.status} → ${newStatus}`);
      }
    } catch (err) {
      // Non-fatal: log and continue
      console.error(`[${ts()}] [jobs] Status sync error for '${inst.id}':`, err.message);
    }
  }
}

// Start background jobs. Call once at server startup.
function start() {
  // Expiry sweep every 5 minutes
  setInterval(() => {
    try { runExpiryCheck(); } catch (err) {
      console.error(`[${ts()}] [jobs] Expiry sweep crashed:`, err.message);
    }
  }, 5 * 60 * 1000);

  // Status sync every 1 minute
  setInterval(() => {
    try { runStatusSync(); } catch (err) {
      console.error(`[${ts()}] [jobs] Status sync crashed:`, err.message);
    }
  }, 60 * 1000);

  console.log(`[${ts()}] [jobs] Background jobs started (expiry: 5min, status-sync: 1min)`);
}

module.exports = { start, runExpiryCheck, runStatusSync };
