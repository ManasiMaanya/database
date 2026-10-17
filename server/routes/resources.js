'use strict';
const express = require('express');
const db = require('../db');
const { RESOURCES } = require('../schema');
const { validateResource, intId } = require('../services/validate');
const { notFound, badRequest } = require('../middleware/errors');

const router = express.Router();

/** Resolve :type to its definition or fail with 404. */
function defFor(type) {
  const def = RESOURCES[type];
  if (!def) throw notFound(`Unknown resource type "${type}".`);
  return def;
}

/** GET /api/resources - the list of resource types the UI can manage. */
router.get('/', (req, res) => {
  res.json({
    types: Object.entries(RESOURCES).map(([key, def]) => ({
      key,
      table: def.table,
      pk: def.pk,
      columns: def.columns,
    })),
  });
});

/** GET /api/resources/:type */
router.get('/:type', async (req, res, next) => {
  try {
    const def = defFor(req.params.type);
    const rows = await db.query(
      `SELECT ${def.pk}, ${def.columns.join(', ')} FROM ${def.table} ORDER BY ${def.pk}`
    );
    res.json({ type: req.params.type, rows });
  } catch (err) {
    next(err);
  }
});

/** POST /api/resources/:type */
router.post('/:type', async (req, res, next) => {
  try {
    const def = defFor(req.params.type);
    const values = validateResource(def, req.body, false);
    const cols = Object.keys(values);
    const sql = `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    const result = await db.pool.execute(sql, Object.values(values));
    const id = result[0].insertId;
    const row = await db.one(`SELECT ${def.pk}, ${def.columns.join(', ')} FROM ${def.table} WHERE ${def.pk} = ?`, [id]);
    res.status(201).json({ row });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/resources/:type/:id */
router.put('/:type/:id', async (req, res, next) => {
  try {
    const def = defFor(req.params.type);
    const id = intId(req.params.id, def.pk);
    const values = validateResource(def, req.body, true);
    const cols = Object.keys(values);
    if (!cols.length) throw badRequest('No fields to update.');

    const sql = `UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${def.pk} = ?`;
    const [result] = await db.pool.execute(sql, [...Object.values(values), id]);
    if (!result.affectedRows) throw notFound('Record not found.');

    const row = await db.one(`SELECT ${def.pk}, ${def.columns.join(', ')} FROM ${def.table} WHERE ${def.pk} = ?`, [id]);
    res.json({ row });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/resources/:type/:id
 * Referential integrity is enforced by the database (RESTRICT); a record still
 * in use comes back as 409 from the error handler.
 */
router.delete('/:type/:id', async (req, res, next) => {
  try {
    const def = defFor(req.params.type);
    const id = intId(req.params.id, def.pk);
    const [result] = await db.pool.execute(`DELETE FROM ${def.table} WHERE ${def.pk} = ?`, [id]);
    if (!result.affectedRows) throw notFound('Record not found.');
    res.json({ ok: true, deleted: id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
