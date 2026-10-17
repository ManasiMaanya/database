'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized } = require('./errors');

/** Sign a token for an account id. */
function signToken(accountId) {
  return jwt.sign({ sub: accountId }, config.jwtSecret, { expiresIn: config.jwtExpiry });
}

/**
 * Load the signed-in doctor behind an account id.
 *
 * Returns the same identity shape the original prototype used so the UI can
 * keep asking "is this surgery mine?" without changes:
 *   { account, role, type, key, id, row }
 * where type is 'surgeon' | 'anesthetist' and key is 'surgeon_id' | 'anesthetist_id'.
 */
async function loadDoctor(accountId) {
  const account = await db.one(
    'SELECT account_id, email, surgeon_id, anesthetist_id FROM Doctor_Account WHERE account_id = ?',
    [accountId]
  );
  if (!account) return null;

  const isSurgeon = account.surgeon_id != null;
  const type = isSurgeon ? 'surgeon' : 'anesthetist';
  const id = isSurgeon ? account.surgeon_id : account.anesthetist_id;

  const row = await db.one(
    `SELECT * FROM ${isSurgeon ? 'Surgeon' : 'Anesthetist'} WHERE ${
      isSurgeon ? 'surgeon_id' : 'anesthetist_id'
    } = ?`,
    [id]
  );
  if (!row) return null;

  return {
    account,
    role: isSurgeon ? 'Surgeon' : 'Anesthetist',
    type,
    key: isSurgeon ? 'surgeon_id' : 'anesthetist_id',
    id,
    row,
  };
}

/** Require a valid Bearer token; attach req.doctor. */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized('Missing bearer token');

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('Session expired or token invalid');
    }

    const doctor = await loadDoctor(payload.sub);
    if (!doctor) throw unauthorized('Account no longer exists');

    req.doctor = doctor;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { signToken, loadDoctor, requireAuth };
