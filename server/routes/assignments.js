'use strict';
const express = require('express');
const db = require('../db');
const { ENUMS } = require('../schema');
const { intId } = require('../services/validate');
const { badRequest, conflict } = require('../middleware/errors');
const { loadManageableSurgery } = require('../services/access');

const router = express.Router();

/* ------------------------------- nurses ------------------------------- */

/** POST /api/surgeries/:id/nurses */
router.post('/:id/nurses', async (req, res, next) => {
  try {
    const sid = intId(req.params.id, 'surgery_id');
    await loadManageableSurgery(req.doctor, sid);

    const { nurse_id, role } = req.body || {};
    const nid = intId(nurse_id, 'nurse_id');
    if (!ENUMS.nurse_role.includes(role)) {
      throw badRequest(`role must be one of: ${ENUMS.nurse_role.join(', ')}.`);
    }
    const already = await db.one('SELECT 1 AS x FROM Surgery_Nurse WHERE surgery_id = ? AND nurse_id = ?', [sid, nid]);
    if (already) throw conflict('Nurse already assigned to this surgery.');

    // The trigger rejects a nurse booked into two overlapping surgeries.
    await db.pool.execute('INSERT INTO Surgery_Nurse (surgery_id, nurse_id, role) VALUES (?, ?, ?)', [
      sid,
      nid,
      role,
    ]);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/surgeries/:id/nurses/:nurseId */
router.delete('/:id/nurses/:nurseId', async (req, res, next) => {
  try {
    const sid = intId(req.params.id, 'surgery_id');
    const nid = intId(req.params.nurseId, 'nurse_id');
    await loadManageableSurgery(req.doctor, sid);
    await db.pool.execute('DELETE FROM Surgery_Nurse WHERE surgery_id = ? AND nurse_id = ?', [sid, nid]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------- equipment ------------------------------ */

/** POST /api/surgeries/:id/equipment */
router.post('/:id/equipment', async (req, res, next) => {
  try {
    const sid = intId(req.params.id, 'surgery_id');
    await loadManageableSurgery(req.doctor, sid);

    const { equipment_id, quantity } = req.body || {};
    const eid = intId(equipment_id, 'equipment_id');
    const qty = quantity == null ? 1 : Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw badRequest('quantity must be a positive integer.');

    const already = await db.one(
      'SELECT 1 AS x FROM Surgery_Equipment WHERE surgery_id = ? AND equipment_id = ?',
      [sid, eid]
    );
    if (already) throw conflict('Equipment already assigned to this surgery.');

    // The trigger rejects equipment booked into two overlapping surgeries.
    await db.pool.execute(
      'INSERT INTO Surgery_Equipment (surgery_id, equipment_id, quantity) VALUES (?, ?, ?)',
      [sid, eid, qty]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/surgeries/:id/equipment/:equipmentId */
router.delete('/:id/equipment/:equipmentId', async (req, res, next) => {
  try {
    const sid = intId(req.params.id, 'surgery_id');
    const eid = intId(req.params.equipmentId, 'equipment_id');
    await loadManageableSurgery(req.doctor, sid);
    await db.pool.execute('DELETE FROM Surgery_Equipment WHERE surgery_id = ? AND equipment_id = ?', [sid, eid]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
