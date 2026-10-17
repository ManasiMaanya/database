'use strict';
const db = require('../db');
const { DATASET } = require('../schema');

/**
 * Builds the in-memory mirror of the clinical database that the frontend
 * consumes, plus the server-computed scheduling intelligence:
 *
 *   data      - one array per dataset key (dept, surgery, task, ...)
 *   conflicts - surgery_id -> [ 'X double-booked with surgery #N', ... ]
 *   blockers  - surgery_id -> [ every reason a surgery cannot proceed, ... ]
 *   readiness - rows from v_surgery_readiness_full
 *
 * Conflicts and blockers come straight from the SQL views in
 * 01_surgical_scheduling.sql, so the rules live in exactly one place: the
 * database. (The prototype recomputed them in JavaScript.)
 */
async function buildSnapshot() {
  const data = {};
  for (const entry of DATASET) {
    data[entry.key] = await db.query(`SELECT ${entry.columns} FROM ${entry.table}`);
  }

  const conflictRows = await db.query(
    'SELECT a_id, b_id, resource, resource_name FROM v_conflicts ORDER BY a_id, b_id, resource'
  );
  const conflicts = {};
  const push = (map, key, message) => {
    (map[key] ||= []).includes(message) || map[key].push(message);
  };
  for (const r of conflictRows) {
    push(conflicts, r.a_id, `${r.resource_name} double-booked with surgery #${r.b_id} (${r.resource})`);
    push(conflicts, r.b_id, `${r.resource_name} double-booked with surgery #${r.a_id} (${r.resource})`);
  }

  const blockerRows = await db.query(
    'SELECT surgery_id, reason FROM v_surgery_blockers ORDER BY surgery_id, reason'
  );
  const blockers = {};
  for (const r of blockerRows) {
    (blockers[r.surgery_id] ||= []).push(r.reason);
  }

  const readiness = await db.query(
    'SELECT surgery_id, status, blockers, readiness FROM v_surgery_readiness_full ORDER BY surgery_id'
  );

  return { data, conflicts, blockers, readiness };
}

module.exports = { buildSnapshot };
