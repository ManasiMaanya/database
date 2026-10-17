'use strict';
const express = require('express');
const db = require('../db');
const { signToken, loadDoctor, requireAuth } = require('../middleware/auth');
const { badRequest, conflict, unauthorized } = require('../middleware/errors');
const { newSalt, hashPassword, verifyPassword } = require('../services/passwords');

const router = express.Router();

/** Public shape of the signed-in doctor. */
function publicUser(doctor) {
  return {
    account_id: doctor.account.account_id,
    email: doctor.account.email,
    role: doctor.role, // 'Surgeon' | 'Anesthetist'
    type: doctor.type, // 'surgeon' | 'anesthetist'
    key: doctor.key, // 'surgeon_id' | 'anesthetist_id'
    id: doctor.id,
    row: doctor.row,
  };
}

const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/**
 * POST /api/auth/register
 * Creates a doctor row (Surgeon or Anesthetist) and its login, atomically.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { role, name, specialization, phone, dept_id, email, password } = req.body || {};
    const errors = [];

    const isSurgeon = role === 'Surgeon';
    if (!isSurgeon && role !== 'Anesthetist') errors.push('Role must be Surgeon or Anesthetist.');

    let cleanName = String(name || '').trim();
    if (cleanName.length < 3) errors.push('Enter your full name.');
    else if (!/^dr\.?\s/i.test(cleanName)) cleanName = 'Dr. ' + cleanName;

    if (isSurgeon && !String(specialization || '').trim()) errors.push('Enter your specialization.');
    if (!/^[0-9]{10}$/.test(String(phone || ''))) errors.push('Phone must be exactly 10 digits.');
    if (!isEmail(String(email || ''))) errors.push('Enter a valid email address.');
    if (String(password || '').length < 8) errors.push('Password must be at least 8 characters.');
    if (!Number.isInteger(Number(dept_id))) errors.push('Choose a department.');
    if (errors.length) throw badRequest(errors.join(' '));

    const emailLc = String(email).trim().toLowerCase();
    const table = isSurgeon ? 'Surgeon' : 'Anesthetist';
    const pk = isSurgeon ? 'surgeon_id' : 'anesthetist_id';

    if (await db.one('SELECT account_id FROM Doctor_Account WHERE email = ?', [emailLc])) {
      throw conflict('An account with that email already exists. Try signing in.');
    }
    if (await db.one(`SELECT ${pk} FROM ${table} WHERE phone = ?`, [phone])) {
      throw conflict('That phone number is already registered.');
    }

    const doctorId = await db.transaction(async (tx) => {
      const insertDoctor = isSurgeon
        ? 'INSERT INTO Surgeon (name, specialization, phone, dept_id) VALUES (?, ?, ?, ?)'
        : 'INSERT INTO Anesthetist (name, phone, dept_id) VALUES (?, ?, ?)';
      const params = isSurgeon
        ? [cleanName, String(specialization).trim(), phone, Number(dept_id)]
        : [cleanName, phone, Number(dept_id)];
      await tx.query(insertDoctor, params);
      const newId = await tx.scalar('SELECT LAST_INSERT_ID()');

      const salt = newSalt();
      await tx.query(
        'INSERT INTO Doctor_Account (email, password_salt, password_hash, surgeon_id, anesthetist_id) VALUES (?, ?, ?, ?, ?)',
        [emailLc, salt, hashPassword(salt, password), isSurgeon ? newId : null, isSurgeon ? null : newId]
      );
      return newId;
    });

    const account = await db.one(
      'SELECT account_id FROM Doctor_Account WHERE surgeon_id <=> ? AND anesthetist_id <=> ?',
      [isSurgeon ? doctorId : null, isSurgeon ? null : doctorId]
    );
    const doctor = await loadDoctor(account.account_id);
    res.status(201).json({ token: signToken(account.account_id), user: publicUser(doctor) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/login */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const emailLc = String(email || '').trim().toLowerCase();
    if (!emailLc || !password) throw badRequest('Enter your email and password.');

    const account = await db.one('SELECT * FROM Doctor_Account WHERE email = ?', [emailLc]);
    if (!account || !verifyPassword(account.password_salt, password, account.password_hash)) {
      throw unauthorized('That email and password do not match an account.');
    }

    const doctor = await loadDoctor(account.account_id);
    res.json({ token: signToken(account.account_id), user: publicUser(doctor) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/me */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.doctor) });
});

/** GET /api/auth/departments - public list for the sign-up form's dropdown. */
router.get('/departments', async (req, res, next) => {
  try {
    const departments = await db.query('SELECT dept_id, dept_name, location FROM Department ORDER BY dept_name');
    res.json({ departments });
  } catch (err) {
    next(err);
  }
});

/** GET /api/auth/demo-accounts - convenience list for the sign-in screen. */router.get('/demo-accounts', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT a.email,
              CASE WHEN a.surgeon_id IS NOT NULL THEN 'Surgeon' ELSE 'Anesthetist' END AS role,
              COALESCE(s.name, n.name) AS name
       FROM   Doctor_Account a
       LEFT   JOIN Surgeon s     ON s.surgeon_id = a.surgeon_id
       LEFT   JOIN Anesthetist n ON n.anesthetist_id = a.anesthetist_id
       ORDER  BY a.account_id`
    );
    res.json({ accounts: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
