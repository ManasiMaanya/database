#!/usr/bin/env node
'use strict';
/**
 * Diagnoses the database connection without ever printing the password.
 *
 *   npm run db:check
 *
 * It reports the target it is using, inspects the raw .env line for the
 * formatting mistakes that silently corrupt a password, then works through the
 * remaining failure points in order: credentials, server down, database
 * missing, schema not loaded, auth table missing, sample data missing.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../server/config');

const PLACEHOLDER = 'your_mysql_password';
const ENV_PATH = path.join(__dirname, '..', '.env');

/** Describe the password without revealing it. */
function describe(value) {
  if (value === undefined || value === null) return 'not set at all';
  if (value === '') return '(empty)';
  if (value === PLACEHOLDER) return 'STILL THE PLACEHOLDER FROM .env.example';
  return `set (${value.length} characters)`;
}

/**
 * Read .env directly and report anything that would change the value before
 * dotenv hands it over. Never returns the value itself.
 */
function inspectEnvLine() {
  const notes = [];
  if (!fs.existsSync(ENV_PATH)) {
    notes.push(`No .env file at ${ENV_PATH}`);
    return notes;
  }
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const line = raw.split(/\r?\n/).find((l) => /^\s*DB_PASSWORD\s*=/.test(l));
  if (line === undefined) {
    notes.push('There is no DB_PASSWORD line in .env');
    return notes;
  }

  const rawValue = line.replace(/^\s*DB_PASSWORD\s*=/, '');
  const trimmed = rawValue.trim();
  const quoted = /^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed);
  const inner = quoted ? trimmed.slice(1, -1) : trimmed;

  if (rawValue !== trimmed) notes.push('There is whitespace around the value after the = sign');
  if (quoted) notes.push('The value is wrapped in quotes (dotenv strips them - usually what you want)');
  if (!quoted && trimmed.includes('#')) {
    notes.push('The value contains "#" and is NOT quoted, so dotenv treats everything from # onward as a comment');
  }
  if (trimmed.includes(' ')) notes.push('The value contains a space; it must be quoted');
  if (trimmed.includes('$')) notes.push('The value contains "$", which some shells expand');
  if (raw.startsWith('\uFEFF')) notes.push('The file starts with a byte-order mark (BOM)');

  notes.push(`The value in .env is ${inner.length} characters long`);
  return notes;
}

async function main() {
  console.log('Database connection check\n');
  console.log(`  host      ${config.db.host}`);
  console.log(`  port      ${config.db.port}`);
  console.log(`  user      ${config.db.user}`);
  console.log(`  password  ${describe(config.db.password)}`);
  console.log(`  database  ${config.db.database}`);

  const envNotes = inspectEnvLine();
  if (envNotes.length) {
    console.log('\n  .env formatting:');
    for (const note of envNotes) console.log(`    - ${note}`);
  }
  console.log('');

  let conn;
  try {
    // Step 1: can we reach the server at all (no database selected)?
    conn = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      connectTimeout: 5000,
    });
  } catch (err) {
    switch (err.code) {
      case 'ER_ACCESS_DENIED_ERROR':
        console.error('X  MySQL rejected the credentials.');
        console.error('');
        if (config.db.password === PLACEHOLDER) {
          console.error('   .env still has the placeholder from .env.example.');
          console.error('   Set DB_PASSWORD to your real MySQL password.');
        } else if (config.db.password === '') {
          console.error('   DB_PASSWORD is empty. Either your root account really has no');
          console.error('   password, or the line was not picked up. Confirm by hand with:');
          console.error('     mysql -h 127.0.0.1 -P 3306 -u root -e "SELECT 1"');
        } else {
          console.error('   A password was supplied but MySQL did not accept it.');
          console.error('   Check the .env formatting notes above first, then confirm the');
          console.error('   password itself works outside this app:');
          console.error('');
          console.error('     mysql -h 127.0.0.1 -P 3306 -u root -p -e "SELECT VERSION()"');
          console.error('');
          console.error('   If that prompts and succeeds, the password is right and the');
          console.error('   problem is the .env line. If it also fails, the password is');
          console.error('   wrong (or the account is not "root").');
          console.error('');
          console.error('   Note: this app connects over TCP as the user above. MySQL');
          console.error("   distinguishes 'root'@'localhost' from 'root'@'%', and some");
          console.error('   installs give the root account a different password than the');
          console.error('   one MySQL Workbench remembers.');
        }
        break;
      case 'ECONNREFUSED':
        console.error(`X  Nothing is listening on ${config.db.host}:${config.db.port}.`);
        console.error('   Is the MySQL service running? Try:  Get-Service *mysql*');
        break;
      case 'ER_BAD_DB_ERROR':
        console.error('X  Credentials are fine, but this database does not exist yet.');
        break;
      case 'ENOTFOUND':
        console.error(`X  Host "${config.db.host}" could not be resolved.`);
        break;
      default:
        console.error(`X  ${err.code || ''} ${err.message}`);
    }
    process.exit(1);
  }

  const [versionRows] = await conn.query('SELECT VERSION() AS v');
  console.log(`  connected to MySQL ${versionRows[0].v}`);

  // Step 2: does the database exist?
  const [dbs] = await conn.query('SHOW DATABASES LIKE ?', [config.db.database]);
  if (!dbs.length) {
    console.error(`\nX  The database "${config.db.database}" does not exist.`);
    console.error('   Create it with:  npm run db:load');
    await conn.end();
    process.exit(1);
  }
  console.log(`  database "${config.db.database}" exists`);
  await conn.changeUser({ database: config.db.database });

  // Step 3: are the tables there?
  const [tables] = await conn.query('SHOW TABLES');
  const names = tables.map((t) => Object.values(t)[0]);
  console.log(`  ${names.length} tables found`);
  if (!names.includes('Surgery')) {
    console.error('\nX  The schema is not loaded (no Surgery table).');
    console.error('   Run:  npm run db:load');
    await conn.end();
    process.exit(1);
  }

  // Step 4: the application's own table.
  if (!names.includes('Doctor_Account')) {
    console.error('\nX  Doctor_Account is missing, so nobody can sign in.');
    console.error('   Run:  npm run db:load     (it runs sql/02_auth.sql)');
    await conn.end();
    process.exit(1);
  }

  // Step 5: is there data, and can anyone log in?
  const [countRows] = await conn.query(`
    SELECT (SELECT COUNT(*) FROM Surgery) AS surgeries,
           (SELECT COUNT(*) FROM Doctor_Account) AS accounts
  `);
  const counts = countRows[0];
  console.log(`  ${counts.surgeries} surgeries, ${counts.accounts} doctor accounts`);

  await conn.end();

  if (!counts.surgeries || !counts.accounts) {
    console.error('\nX  The schema is loaded but empty. Run:  npm run db:load');
    process.exit(1);
  }

  console.log('\nOK  Everything checks out. Start the server with:  npm start');
}

main().catch((err) => {
  console.error('\nUnexpected error:', err.message);
  process.exit(1);
});
