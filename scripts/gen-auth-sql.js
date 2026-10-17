#!/usr/bin/env node
/**
 * Generates sql/02_auth.sql -- the Doctor_Account table plus one login per
 * sample doctor.
 *
 * The Review 2 schema (01_surgical_scheduling.sql) models patients, staff,
 * theatres, surgeries and dependencies, but it has no notion of "who is signed
 * in". The Review 3 prototype added a Doctor_Account table for that. This
 * script recreates it as a separate, additive migration so the original
 * Review 2 script stays untouched.
 *
 * Password hashing matches the browser prototype exactly so the same demo
 * credentials keep working:
 *     hash = sha256(salt + password)   (hex, lower case)
 *
 * Run:  node scripts/gen-auth-sql.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const saltFor = (n) => 'ssdm' + String(n).padStart(2, '0');

// Same derivation the frontend uses: strip "Dr. ", lower case, spaces -> dots.
const emailFor = (name) =>
  name.replace(/^Dr\.\s*/, '').toLowerCase().replace(/\s+/g, '.') + '@hospital.test';

// Mirrors the seed data in 01_surgical_scheduling.sql (surgeon_id / name).
const SURGEONS = [
  [1, 'Dr. Rohan Iyer'],
  [2, 'Dr. Meera Krishnan'],
  [3, 'Dr. Sandeep Verma'],
  [4, 'Dr. Anita Desai'],
  [5, 'Dr. Farhan Qureshi'],
  [6, 'Dr. Lakshmi Rao'],
];

const ANESTHETISTS = [
  [1, 'Dr. Kavita Menon'],
  [2, 'Dr. Arvind Pillai'],
  [3, 'Dr. Neha Bansal'],
  [4, 'Dr. Imran Sheikh'],
];

const escape = (s) => String(s).replace(/'/g, "''");

function build() {
  const rows = [];
  let accountId = 0;

  for (const [surgeonId, name] of SURGEONS) {
    accountId += 1;
    const salt = saltFor(accountId);
    rows.push(
      ` (${accountId}, '${escape(emailFor(name))}', '${salt}', '${sha256(salt + DEMO_PASSWORD)}', ${surgeonId}, NULL)`
    );
  }
  for (const [anesthetistId, name] of ANESTHETISTS) {
    accountId += 1;
    const salt = saltFor(accountId);
    rows.push(
      ` (${accountId}, '${escape(emailFor(name))}', '${salt}', '${sha256(salt + DEMO_PASSWORD)}', NULL, ${anesthetistId})`
    );
  }

  return `-- =====================================================================
-- Surgical Scheduling and Dependency Management System
-- Migration 02: Doctor_Account (application login table)
--
-- Additive to 01_surgical_scheduling.sql. The Review 2 schema stores the
-- clinical data; this table stores who signs in to the application.
--
-- One row per doctor: either a Surgeon or an Anesthetist, never both.
-- The password is sha256(salt || password), matching the original
-- browser prototype so the demo credentials are unchanged.
--
-- Load order:  01_surgical_scheduling.sql  ->  02_auth.sql
-- =====================================================================

USE surgical_scheduling;

CREATE TABLE IF NOT EXISTS Doctor_Account (
    account_id      INT           AUTO_INCREMENT PRIMARY KEY,
    email           VARCHAR(120)  NOT NULL UNIQUE,
    password_salt   VARCHAR(32)   NOT NULL,
    password_hash   CHAR(64)      NOT NULL,
    surgeon_id      INT           NULL,
    anesthetist_id  INT           NULL,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_account_surgeon
        FOREIGN KEY (surgeon_id) REFERENCES Surgeon(surgeon_id) ON DELETE CASCADE,
    CONSTRAINT fk_account_anesthetist
        FOREIGN KEY (anesthetist_id) REFERENCES Anesthetist(anesthetist_id) ON DELETE CASCADE,
    -- Exactly one of the two doctor columns must be set.
    CONSTRAINT chk_account_one_doctor
        CHECK ((surgeon_id IS NULL) <> (anesthetist_id IS NULL))
);

-- Idempotent seed: clear the demo logins, then insert them fresh.
DELETE FROM Doctor_Account;

INSERT INTO Doctor_Account
    (account_id, email, password_salt, password_hash, surgeon_id, anesthetist_id)
VALUES
${rows.join(',\n')};

-- Keep AUTO_INCREMENT ahead of the seeded ids.
ALTER TABLE Doctor_Account AUTO_INCREMENT = ${accountId + 1};

-- Demo logins (password: ${DEMO_PASSWORD})
SELECT account_id, email,
       CASE WHEN surgeon_id IS NOT NULL THEN 'Surgeon' ELSE 'Anesthetist' END AS role
FROM   Doctor_Account
ORDER  BY account_id;
`;
}

const outPath = path.join(__dirname, '..', 'sql', '02_auth.sql');
fs.writeFileSync(outPath, build(), 'utf8');
console.log('Wrote ' + outPath);
console.log('Demo password: ' + DEMO_PASSWORD);
