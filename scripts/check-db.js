#!/usr/bin/env node
'use strict';
/**
 * Diagnoses the database connection without ever printing the password.
 *
 *   npm run db:check
 *
 * It reports the target it is using, then works through the likely failure
 * points in order: credentials, database missing, schema not loaded, auth
 * table missing, and sample data missing.
 */
const mysql = require('mysql2/promise');
const config = require('../server/config');

const PLACEHOLDER = 'your_mysql_password';

function mask(value) {
  if (value === undefined || value === null || value === '') return '(empty)';
  if (value === PLACEHOLDER) return '*** STILL THE PLACEHOLDER VALUE FROM .env.example ***';
  return '*'.repeat(Math.min(value.length, 12));
}

async function main() {
  console.log('Database connection check\n');
  console.log(`  host      ${config.db.host}`);
  console.log(`  port      ${config.db.port}`);
  console.log(`  user      ${config.db.user}`);
  console.log(`  password  ${mask(config.db.password)}`);
  console.log(`  database  ${config.db.database}`);
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
          console.error('   .env still contains the placeholder from .env.example.');
          console.error('   Open .env and set DB_PASSWORD to your real MySQL root password.');
        } else if (!config.db.password) {
          console.error('   DB_PASSWORD is empty. If your root account has no password, that is');
          console.error('   correct -- but confirm it with:');
          console.error('     mysql -h 127.0.0.1 -P 3306 -u root -e "SELECT 1"');
        } else {
          console.error('   The password in .env does not match. Things to check:');
          console.error('     - Is this the password for user "' + config.db.user + '"?');
          console.error('     - If it contains #, ; or spaces, wrap it in quotes in .env:');
          console.error('         DB_PASSWORD="my#pass word"');
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
