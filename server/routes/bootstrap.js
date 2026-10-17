'use strict';
const express = require('express');
const { buildSnapshot } = require('../services/snapshot');

const router = express.Router();

/**
 * GET /api/bootstrap
 *
 * One request that returns everything the single-page app needs to render:
 * the whole clinical dataset, the server-computed conflict and blocker maps
 * (from the SQL views) and the signed-in doctor. The client keeps a live
 * mirror of this and refreshes it after every successful write.
 */
router.get('/', async (req, res, next) => {
  try {
    const snapshot = await buildSnapshot();
    res.json({
      user: {
        account_id: req.doctor.account.account_id,
        email: req.doctor.account.email,
        role: req.doctor.role,
        type: req.doctor.type,
        key: req.doctor.key,
        id: req.doctor.id,
        row: req.doctor.row,
      },
      ...snapshot,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
