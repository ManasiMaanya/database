'use strict';
require('dotenv').config();

const config = {
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'surgical_scheduling',
  },
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
  jwtExpiry: process.env.JWT_EXPIRY || '12h',
};

if (!process.env.JWT_SECRET) {
  // Loud, because a default secret means anyone can mint a valid token.
  console.warn(
    '[config] JWT_SECRET is not set - falling back to an insecure development value. ' +
      'Copy .env.example to .env before running this anywhere real.'
  );
}

module.exports = config;
