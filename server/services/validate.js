'use strict';
const { ENUMS } = require('../schema');
const { badRequest } = require('../middleware/errors');

/**
 * Validate and coerce a resource payload against its schema definition.
 *
 * @param {object} def      entry from RESOURCES
 * @param {object} body     raw request body
 * @param {boolean} partial true for updates: only validate supplied columns
 * @returns {object} clean values keyed by column
 */
function validateResource(def, body, partial = false) {
  if (!body || typeof body !== 'object') throw badRequest('A JSON body is required.');
  const out = {};

  for (const col of def.columns) {
    const supplied = Object.prototype.hasOwnProperty.call(body, col);

    if (!supplied) {
      if (!partial && def.required.includes(col)) {
        throw badRequest(`Field "${col}" is required.`);
      }
      continue;
    }

    let value = body[col];
    if (value === '') value = null;

    if (value === null) {
      if (def.required.includes(col)) throw badRequest(`Field "${col}" is required.`);
      out[col] = null;
      continue;
    }

    if (def.number.includes(col)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw badRequest(`Field "${col}" must be a number.`);
      value = n;
    } else {
      value = String(value).trim();
    }

    const enumKey = def.enums[col];
    if (enumKey && !ENUMS[enumKey].includes(value)) {
      throw badRequest(`Field "${col}" must be one of: ${ENUMS[enumKey].join(', ')}.`);
    }

    // Light domain checks that mirror the CHECK constraints, for clearer errors.
    if (col === 'est_duration_min' && value <= 0) {
      throw badRequest('Estimated duration must be greater than 0.');
    }
    if (col === 'dob' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw badRequest('Date of birth must look like YYYY-MM-DD.');
    }
    if (col === 'phone' && !/^[0-9]{10}$/.test(value)) {
      throw badRequest('Phone must be exactly 10 digits.');
    }

    out[col] = value;
  }

  if (!partial && Object.keys(out).length === 0) {
    throw badRequest('No valid fields were supplied.');
  }
  return out;
}

/** Assert a value is a positive integer (ids and quantities). */
function intId(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`"${name}" must be a positive integer.`);
  return n;
}

module.exports = { validateResource, intId };
