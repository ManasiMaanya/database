'use strict';
const express = require('express');
const db = require('../db');
const { ENUMS } = require('../schema');
const { intId } = require('../services/validate');
const { badRequest } = require('../middleware/errors');
const { SURGERY_COLUMNS, loadSurgery, loadManageableSurgery } = require('../services/access');

const router = express.Router();

/** The six parent references plus the scheduling columns. */
const SURGERY_REFS = ['patient_id', 'procedure_id', 'surgeon_id', 'anesthetist_id', 'ot_id', 'bed_id'];


const timeRe = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/** Validate and normalise a surgery payload. */
function parseSurgery(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  for (const k of SURGERY_REFS) {
    if (!has(k)) {
      if (!partial) throw badRequest(`Field "${k}" is required.`);
      continue;
    }
    out[k] = intId(body[k], k);
  }
  if (has('surgery_date') || !partial) {
    if (!dateRe.test(String(body.surgery_date || ''))) throw badRequest('surgery_date must look like YYYY-MM-DD.');
    out.surgery_date = body.surgery_date;
  }
  if (has('start_time') || !partial) {
    if (!timeRe.test(String(body.start_time || ''))) throw badRequest('start_time must look like HH:MM.');
    out.start_time = body.start_time;
  }
  if (has('priority')) {
    if (!ENUMS.priority.includes(body.priority)) throw badRequest('priority must be Routine, Urgent or Emergency.');
    out.priority = body.priority;
  }
  if (has('status')) {
    if (!ENUMS.surgery_status.includes(body.status)) throw badRequest('Invalid status.');
    out.status = body.status;
  }
  return out;
}

/** GET /api/surgeries */
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(`SELECT ${SURGERY_COLUMNS} FROM Surgery ORDER BY surgery_date, start_time`);
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

/** GET /api/surgeries/:id - detail with tasks, team, links and live rule state. */
router.get('/:id', async (req, res, next) => {
  try {
    const id = intId(req.params.id, 'surgery_id');
    const surgery = await loadSurgery(id);
    const [tasks, nurses, equipment, dependsOn, blocks, conflicts, blockers] = await Promise.all([
      db.query('SELECT * FROM Pre_Op_Task WHERE surgery_id = ? ORDER BY task_id', [id]),
      db.query(
        'SELECT sn.surgery_id, sn.nurse_id, sn.role, n.name, n.shift FROM Surgery_Nurse sn JOIN Nurse n ON n.nurse_id = sn.nurse_id WHERE sn.surgery_id = ?',
        [id]
      ),
      db.query(
        'SELECT se.surgery_id, se.equipment_id, se.quantity, e.equipment_name, e.sterile_status FROM Surgery_Equipment se JOIN Equipment e ON e.equipment_id = se.equipment_id WHERE se.surgery_id = ?',
        [id]
      ),
      db.query('SELECT * FROM Surgery_Dependency WHERE successor_surgery_id = ?', [id]),
      db.query('SELECT * FROM Surgery_Dependency WHERE predecessor_surgery_id = ?', [id]),
      db.query('SELECT a_id, b_id, resource, resource_name FROM v_conflicts WHERE a_id = ? OR b_id = ?', [id, id]),
      db.query('SELECT reason FROM v_surgery_blockers WHERE surgery_id = ?', [id]),
    ]);
    res.json({
      surgery,
      tasks,
      nurses,
      equipment,
      dependsOn,
      blocks,
      conflicts,
      blockers: blockers.map((b) => b.reason),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/surgeries
 * The BEFORE INSERT trigger rejects any resource double-booking or a theatre
 * under maintenance, so a 201 here means the slot is genuinely free.
 */
router.post('/', async (req, res, next) => {
  try {
    const values = parseSurgery(req.body);
    const cols = Object.keys(values);
    const sql = `INSERT INTO Surgery (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    const [result] = await db.pool.execute(sql, Object.values(values));
    const surgery = await loadSurgery(result.insertId);
    res.status(201).json({ surgery });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/surgeries/:id */
router.put('/:id', async (req, res, next) => {
  try {
    const id = intId(req.params.id, 'surgery_id');
    await loadManageableSurgery(req.doctor, id);

    const values = parseSurgery(req.body, { partial: true });
    const cols = Object.keys(values);
    if (!cols.length) throw badRequest('No fields to update.');

    const sql = `UPDATE Surgery SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE surgery_id = ?`;
    await db.pool.execute(sql, [...Object.values(values), id]);
    const surgery = await loadSurgery(id);
    res.json({ surgery });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/surgeries/:id/status
 * Marking Ready/Completed is guarded by the database trigger: it returns 409
 * with the first blocker if anything is unfinished.
 */
router.patch('/:id/status', async (req, res, next) => {
  try {
    const id = intId(req.params.id, 'surgery_id');
    const { status } = req.body || {};
    if (!ENUMS.surgery_status.includes(status)) {
      throw badRequest(`status must be one of: ${ENUMS.surgery_status.join(', ')}.`);
    }
    await loadManageableSurgery(req.doctor, id);

    await db.pool.execute('UPDATE Surgery SET status = ? WHERE surgery_id = ?', [status, id]);
    res.json({ surgery: await loadSurgery(id) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/surgeries/:id
 * ON DELETE CASCADE removes the surgery's tasks, team, equipment and links.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = intId(req.params.id, 'surgery_id');
    await loadManageableSurgery(req.doctor, id);
    await db.pool.execute('DELETE FROM Surgery WHERE surgery_id = ?', [id]);
    res.json({ ok: true, deleted: id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
