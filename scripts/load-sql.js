#!/usr/bin/env node
'use strict';
/**
 * Loads every .sql file in ./sql into MySQL, in filename order.
 *
 *   node scripts/load-sql.js
 *
 * It understands the client-side DELIMITER command used by the Review 2 script
 * for stored procedures and triggers, so the whole file can be executed
 * statement by statement without the mysql command-line client.
 *
 * WARNING: 01_surgical_scheduling.sql begins with DROP DATABASE. Running this
 * recreates the database from scratch -- any existing data is lost.
 *
 * Set FORCE=1 to skip the confirmation prompt (useful in scripts).
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mysql = require('mysql2/promise');
const config = require('../server/config');

const SQL_DIR = path.join(__dirname, '..', 'sql');

/** Remove -- and /* *\/ comments while leaving string literals intact. */
function stripComments(sql) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '#') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Split a script into statements, honouring DELIMITER $$ ... $$ blocks and
 * keeping $ inside procedure/trigger bodies with the rest of the statement.
 */
function splitStatements(sql) {
  const statements = [];
  let delimiter = ';';
  let buffer = '';

  for (const rawLine of sql.split(/\r?\n/)) {
    const delimiterMatch = rawLine.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      delimiter = delimiterMatch[1];
      continue;
    }
    buffer += rawLine + '\n';

    const trimmed = buffer.replace(/\s+$/, '');
    if (trimmed.endsWith(delimiter)) {
      const statement = trimmed.slice(0, -delimiter.length).trim();
      if (statement) statements.push(statement);
      buffer = '';
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

function confirm(question) {
  if (process.env.FORCE === '1') return Promise.resolve(true);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    })
  );
}

async function main() {
  const files = fs
    .readdirSync(SQL_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  if (!files.length) {
    console.error(`No .sql files found in ${SQL_DIR}`);
    process.exit(1);
  }

  console.log(`Target: ${config.db.user}@${config.db.host}:${config.db.port}`);
  console.log('Files to run:');
  for (const f of files) console.log(`  - sql/${f}`);
  console.log('\n01_surgical_scheduling.sql runs DROP DATABASE surgical_scheduling.');

  if (!(await confirm('Continue? [y/N] '))) {
    console.log('Aborted.');
    process.exit(0);
  }

  // No database selected: the script creates and selects it itself.
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: false,
    dateStrings: true,
  });

  let total = 0;
  try {
    for (const file of files) {
      const sql = stripComments(fs.readFileSync(path.join(SQL_DIR, file), 'utf8'));
      const statements = splitStatements(sql);
      let count = 0;
      for (const statement of statements) {
        await conn.query(statement);
        count += 1;
      }
      total += count;
      console.log(`  [ok] ${file} (${count} statements)`);
    }
  } finally {
    await conn.end();
  }
  console.log(`\nDone. ${total} statements executed.`);
  console.log('Start the server with:  npm start');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nLoad failed:', err.message);
    process.exit(1);
  });
}

module.exports = { stripComments, splitStatements };

