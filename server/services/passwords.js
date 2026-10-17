'use strict';
const crypto = require('crypto');

/**
 * Password hashing for Doctor_Account.
 *
 * The stored value is sha256(salt || password) in lower-case hex. This is the
 * exact scheme the original browser prototype used, so the demo logins in
 * sql/02_auth.sql keep working unchanged.
 *
 * Note: a plain SHA-256 is fast and therefore weak against offline guessing.
 * It is kept here for fidelity with the course prototype and its seeded data.
 * Anything public should move to bcrypt/argon2 (see README, "Security notes").
 */

/** New random salt, same shape as the seeded ones ('ssdm' + 6 base36 chars). */
function newSalt() {
  return 'ssdm' + crypto.randomBytes(4).toString('hex').slice(0, 6);
}

function hashPassword(salt, password) {
  return crypto.createHash('sha256').update(salt + password, 'utf8').digest('hex');
}

/** Constant-time compare so a wrong password cannot be found byte by byte. */
function verifyPassword(salt, password, expectedHash) {
  const actual = Buffer.from(hashPassword(salt, password), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { newSalt, hashPassword, verifyPassword };
