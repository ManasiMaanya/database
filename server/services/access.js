'use strict';
const db = require('../db');
const { notFound, forbidden } = require('../middleware/errors');

const SURGERY_COLUMNS =
  "surgery_id, surgery_date, TIME_FORMAT(start_time, '%H:%i') AS start_time, priority, status, " +
  'patient_id, procedure_id, surgeon_id, anesthetist_id, ot_id, bed_id';

async function loadSurgery(id) {
  const row = await db.one(`SELECT ${SURGERY_COLUMNS} FROM Surgery WHERE surgery_id = ?`, [id]);
  if (!row) throw notFound(`Surgery #${id} was not found.`);
  return row;
}

/** Only a doctor on the surgery may change it (matches the UI's read-only rule). */
function assertCanManage(doctor, surgery) {
  if (surgery[doctor.key] !== doctor.id) {
    throw forbidden("This is a colleague's booking; only the doctors on it can change it.");
  }
}

/** Load a surgery and confirm the signed-in doctor is on it. */
async function loadManageableSurgery(doctor, id) {
  const surgery = await loadSurgery(id);
  assertCanManage(doctor, surgery);
  return surgery;
}

module.exports = { SURGERY_COLUMNS, loadSurgery, assertCanManage, loadManageableSurgery };
