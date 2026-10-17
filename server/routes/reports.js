'use strict';
const express = require('express');
const db = require('../db');
const { badRequest } = require('../middleware/errors');

const router = express.Router();

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/reports/theatre-utilization?date=YYYY-MM-DD
 * Calls the stored procedure sp_theatre_utilization(08:00-18:00 = 600 minutes).
 */
router.get('/theatre-utilization', async (req, res, next) => {
  try {
    const date = req.query.date;
    if (!dateRe.test(String(date || ''))) throw badRequest('A date query parameter (YYYY-MM-DD) is required.');
    const [rows] = await db.pool.query('CALL sp_theatre_utilization(?)', [date]);
    res.json({ date, rows: Array.isArray(rows) ? rows[0] : rows });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reports/surgeon-workload - Q2: GROUP BY / HAVING / aggregates. */
router.get('/surgeon-workload', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT sg.name                          AS surgeon,
              COUNT(*)                         AS surgeries,
              SUM(p.est_duration_min)          AS total_minutes,
              ROUND(AVG(p.est_duration_min))   AS avg_minutes,
              MAX(p.est_duration_min)          AS longest
       FROM   Surgery s
       JOIN   Surgeon sg           ON sg.surgeon_id  = s.surgeon_id
       JOIN   Surgical_Procedure p ON p.procedure_id = s.procedure_id
       WHERE  s.status <> 'Cancelled'
       GROUP  BY sg.name
       HAVING COUNT(*) >= 1
       ORDER  BY total_minutes DESC, surgeon`
    );
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reports/pending-tasks - v_pending_tasks. */
router.get('/pending-tasks', async (req, res, next) => {
  try {
    res.json({ rows: await db.query('SELECT * FROM v_pending_tasks ORDER BY open_tasks DESC, surgery_id') });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reports/status-counts - v_status_counts. */
router.get('/status-counts', async (req, res, next) => {
  try {
    res.json({ rows: await db.query('SELECT * FROM v_status_counts ORDER BY status') });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reports/conflicts - v_conflicts: every overlap and shared resource. */
router.get('/conflicts', async (req, res, next) => {
  try {
    res.json({ rows: await db.query('SELECT * FROM v_conflicts ORDER BY a_id, b_id, resource') });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reports/readiness - v_surgery_readiness_full. */
router.get('/readiness', async (req, res, next) => {
  try {
    res.json({ rows: await db.query('SELECT * FROM v_surgery_readiness_full ORDER BY surgery_id') });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reports/schedule - v_surgery_schedule (six-table join with end time). */
router.get('/schedule', async (req, res, next) => {
  try {
    res.json({ rows: await db.query('SELECT * FROM v_surgery_schedule ORDER BY surgery_date, start_time') });
  } catch (err) {
    next(err);
  }
});

/** GET /api/reports/task-chain?surgery_id=1 - v_task_chain (recursive CTE). */
router.get('/task-chain', async (req, res, next) => {
  try {
    const sid = Number(req.query.surgery_id);
    if (!Number.isInteger(sid) || sid <= 0) throw badRequest('A surgery_id query parameter is required.');
    res.json({ rows: await db.query('SELECT * FROM v_task_chain WHERE surgery_id = ? ORDER BY step', [sid]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
