'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { requireAuth } = require('./middleware/auth');
const { errorHandler, notFound } = require('./middleware/errors');

const authRoutes = require('./routes/auth');
const bootstrapRoutes = require('./routes/bootstrap');
const resourceRoutes = require('./routes/resources');
const surgeryRoutes = require('./routes/surgeries');
const taskRoutes = require('./routes/tasks');
const dependencyRoutes = require('./routes/dependencies');
const assignmentRoutes = require('./routes/assignments');
const reportRoutes = require('./routes/reports');

const app = express();

app.use(express.json({ limit: '256kb' }));

/** GET /api/health - liveness plus a quick database round-trip. */
app.get('/api/health', async (req, res) => {
  try {
    const version = await db.scalar('SELECT VERSION()');
    res.json({ ok: true, database: config.db.database, mysql: version });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// Public: sign in / sign up.
app.use('/api/auth', authRoutes);

// Everything below needs a valid token.
app.use('/api/bootstrap', requireAuth, bootstrapRoutes);
app.use('/api/resources', requireAuth, resourceRoutes);
app.use('/api/surgeries', requireAuth, surgeryRoutes);
app.use('/api/tasks', requireAuth, taskRoutes);
// Assignments are nested under surgeries (:id/nurses, :id/equipment).
app.use('/api/surgeries', requireAuth, assignmentRoutes);
app.use('/api/reports', requireAuth, reportRoutes);
// Dependency endpoints define their own full paths under /api.
app.use('/api', requireAuth, dependencyRoutes);

// The frontend is a static single-page app served from /public.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Any non-API path falls through to the app shell, so deep links work.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use('/api', (req, res, next) => next(notFound('Unknown API endpoint.')));
app.use(errorHandler);

async function start() {
  try {
    // Fail fast and clearly if the database is unreachable or not loaded.
    await db.scalar('SELECT 1');
  } catch (err) {
    console.error(`[server] Cannot connect to database "${config.db.database}" at ${config.db.host}:${config.db.port}.`);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('[server] MySQL rejected the credentials. Check DB_USER / DB_PASSWORD in .env.');
    } else if (err.code === 'ER_BAD_DB_ERROR') {
      console.error('[server] The database does not exist yet. Load it first:  npm run db:load');
    } else {
      console.error(`[server] ${err.message}`);
    }
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`[server] Surgical Scheduling backend on http://localhost:${config.port}`);
    console.log(`[server] Database: ${config.db.database} @ ${config.db.host}:${config.db.port}`);
  });
}

if (require.main === module) start();

module.exports = { app, start };
