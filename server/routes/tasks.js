'use strict';
const express = require('express');
const db = require('../db');
const { ENUMS } = require('../schema');
const { intId } = require('../services/validate');
const { badRequest, notFound } = require('../middleware/errors');
const { loadManageableSurgery } = require('../services/access');

const router = express.Router();

async function loadTask(id) {
  const task = await db.one('SELECT * FROM Pre_Op_Task WHERE task_id = ?', [id]);
  if (!task) throw notFound(`Task #${id} was not found.`);
  return task;
}

/** POST /api/tasks - add a pre-operative task to a surgery. */
router.post('/', async (req, res, next) => {
  try {
    const { surgery_id, task_name, task_type } = req.body || {};
    const sid = intId(surgery_id, 'surgery_id');
    await loadManageableSurgery(req.doctor, sid);

    const name = String(task_name || '').trim();
    if (!name) throw badRequest('Task name is required.');
    if (!ENUMS.task_type.includes(task_type)) {
      throw badRequest(`task_type must be one of: ${ENUMS.task_type.join(', ')}.`);
    }

    const [result] = await db.pool.execute(
      'INSERT INTO Pre_Op_Task (task_name, task_type, surgery_id) VALUES (?, ?, ?)',
      [name, task_type, sid]
    );
    res.status(201).json({ task: await loadTask(result.insertId) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/tasks/:id/status
 * The BEFORE UPDATE trigger refuses to let a task start or finish before its
 * predecessors have progressed far enough, returning 409 with the reason.
 */
router.patch('/:id/status', async (req, res, next) => {
  try {
    const id = intId(req.params.id, 'task_id');
    const task = await loadTask(id);
    await loadManageableSurgery(req.doctor, task.surgery_id);

    const { status } = req.body || {};
    if (!ENUMS.task_status.includes(status)) {
      throw badRequest(`status must be one of: ${ENUMS.task_status.join(', ')}.`);
    }
    await db.pool.execute('UPDATE Pre_Op_Task SET status = ? WHERE task_id = ?', [status, id]);
    res.json({ task: await loadTask(id) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/tasks/:id - cascade removes any dependencies that mention it. */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = intId(req.params.id, 'task_id');
    const task = await loadTask(id);
    await loadManageableSurgery(req.doctor, task.surgery_id);
    await db.pool.execute('DELETE FROM Pre_Op_Task WHERE task_id = ?', [id]);
    res.json({ ok: true, deleted: id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
