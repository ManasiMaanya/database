'use strict';
const mysql = require('mysql2/promise');
const config = require('./config');

/**
 * Single connection pool for the whole application.
 *
 * dateStrings:true keeps DATE columns as 'YYYY-MM-DD' and TIME columns as
 * strings instead of JS Date objects. MySQL has no timezone in DATE/TIME
 * values here, so the raw string is exactly what the database stores and
 * exactly what the frontend expects.
 */
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  // Return DECIMAL/NUMERIC (SUM, AVG, ROUND, ...) as JS numbers, not strings,
  // so report values like utilization_pct arrive ready to use.
  decimalNumbers: true,
  charset: 'utf8mb4',
});

/** Run a query and return the rows. */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * A dropped or idle-killed MySQL connection must not take the process down.
 * Without this listener Node treats the pool's 'error' event as unhandled.
 */
pool.on('error', (err) => {
  console.error('[db] connection error:', err.code || err.message);
});

/** Run a query and return the first row, or null. */
async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/** Run a query and return the first column of the first row, or null. */
async function scalar(sql, params = []) {
  const row = await one(sql, params);
  if (!row) return null;
  return row[Object.keys(row)[0]];
}

/**
 * Run several statements inside one transaction. The callback receives a
 * connection-like handle exposing query/one/scalar. Rolling back on any throw
 * keeps multi-table writes (for example creating a doctor plus their account)
 * atomic.
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  const handle = {
    async query(sql, params = []) {
      const [rows] = await conn.execute(sql, params);
      return rows;
    },
    async one(sql, params = []) {
      const rows = await handle.query(sql, params);
      return rows.length ? rows[0] : null;
    },
    async scalar(sql, params = []) {
      const row = await handle.one(sql, params);
      return row ? row[Object.keys(row)[0]] : null;
    },
  };
  try {
    await conn.beginTransaction();
    const result = await fn(handle);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, one, scalar, transaction };
