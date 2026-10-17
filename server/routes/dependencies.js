'use strict';
const express = require('express');
const db = require('../db');
const { ENUMS } = require('../schema');
const { intId } = require('../services/validate');
const { badRequest, notFound } = require('../middleware/errors');
const { loadManageableSurgery } = require('../services/access');

const router = express.Router();

const depType = (value, fallback = 'Finish-to-start') => {
  const v = value == null ? fallback : value;
  if (!ENUMS.dependency_type.includes(v)) {
    throw badRequest(`dependency_type must be one of: ${ENUMS.dependency_type.join(', ')}.`);
  }
  return v;
};

/* ------------------------------------------------------------------ *
 * Task dependencies: which pre-op task must precede which other task.
 * ------------------------------------------------------------------ */

/** POST /api/task-dependencies */
router.post('/task-dependencies', async (req, res, next) => {
  try {
    const { predecessor_task_id, successor_task_id, dependency_type, lag_minutes } = req.body || {};
    const pred = intId(predecessor_task_id, 'predecessor_task_id');
    const succ = intId(successor_task_id, 'successor_task_id');

    const successor = await db.one('SELECT * FROM Pre_Op_Task WHERE task_id = ?', [succ]);
    if (!successor) throw notFound(`Task #${succ} was not found.`);
    await loadManageableSurgery(req.doctor, successor.surgery_id);

    const lag = lag_minutes == null ? 0 : Number(lag_minutes);
    if (!Number.isInteger(lag) || lag < 0) throw badRequest('lag_minutes must be 0 or more.');

    // The trigger rejects self-dependencies, cross-surgery links and cycles.
    await db.pool.execute(
      'INSERT INTO Task_Dependency (predecessor_task_id, successor_task_id, dependency_type, lag_minutes) VALUES (?, ?, ?, ?)',
      [pred, succ, depType(dependency_type), lag]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/task-dependencies/:pred/:succ */
router.delete('/task-dependencies/:pred/:succ', async (req, res, next) => {
  try {
    const pred = intId(req.params.pred, 'predecessor_task_id');
    const succ = intId(req.params.succ, 'successor_task_id');
    const successor = await db.one('SELECT * FROM Pre_Op_Task WHERE task_id = ?', [succ]);
    if (!successor) throw notFound(`Task #${succ} was not found.`);
    await loadManageableSurgery(req.doctor, successor.surgery_id);

    const [result] = await db.pool.execute(
      'DELETE FROM Task_Dependency WHERE predecessor_task_id = ? AND successor_task_id = ?',
      [pred, succ]
    );
    if (!result.affectedRows) throw notFound('That dependency does not exist.');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Surgery dependencies: staged operations.
 * ------------------------------------------------------------------ */

/** POST /api/surgery-dependencies */
router.post('/surgery-dependencies', async (req, res, next) => {
  try {
    const { predecessor_surgery_id, successor_surgery_id, dependency_type } = req.body || {};
    const pred = intId(predecessor_surgery_id, 'predecessor_surgery_id');
    const succ = intId(successor_surgery_id, 'successor_surgery_id');

    await loadManageableSurgery(req.doctor, succ);

    // The trigger rejects self-links, cycles and a predecessor dated after the successor.
    await db.pool.execute(
      'INSERT INTO Surgery_Dependency (predecessor_surgery_id, successor_surgery_id, dependency_type) VALUES (?, ?, ?)',
      [pred, succ, depType(dependency_type)]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/surgery-dependencies/:pred/:succ */
router.delete('/surgery-dependencies/:pred/:succ', async (req, res, next) => {
  try {
    const pred = intId(req.params.pred, 'predecessor_surgery_id');
    const succ = intId(req.params.succ, 'successor_surgery_id');
    await loadManageableSurgery(req.doctor, succ);

    const [result] = await db.pool.execute(
      'DELETE FROM Surgery_Dependency WHERE predecessor_surgery_id = ? AND successor_surgery_id = ?',
      [pred, succ]
    );
    if (!result.affectedRows) throw notFound('That dependency does not exist.');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
