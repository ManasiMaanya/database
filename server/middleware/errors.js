'use strict';

/** An error that carries an HTTP status code and a safe, user-facing message. */
class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

const badRequest = (msg, details) => new ApiError(400, msg, details);
const unauthorized = (msg = 'Not signed in') => new ApiError(401, msg);
const forbidden = (msg = 'Not allowed') => new ApiError(403, msg);
const notFound = (msg = 'Not found') => new ApiError(404, msg);
const conflict = (msg, details) => new ApiError(409, msg, details);

/**
 * Turns any thrown value into a JSON error response.
 *
 * MySQL rule violations signalled by the triggers in 01_surgical_scheduling.sql
 * arrive as SQLSTATE 45000 (or 1644). Those messages are written for the user
 * ("Surgeon is already booked in overlapping surgery 3"), so they are passed
 * through as 409 Conflict rather than a generic 500.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  const code = err.code || err.sqlState;
  const ruleSignal = err.errno === 1644 || err.sqlState === '45000';

  if (ruleSignal) {
    return res.status(409).json({ error: err.sqlMessage || err.message });
  }
  if (code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'That value already exists and must be unique.' });
  }
  if (code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
    return res.status(400).json({ error: 'A referenced record does not exist.' });
  }
  if (code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
    return res
      .status(409)
      .json({ error: 'Cannot delete: other records still reference this one.' });
  }
  if (code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    return res.status(400).json({ error: 'A value failed a database check constraint.', details: err.sqlMessage });
  }

  console.error('[api] unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  errorHandler,
};
