'use strict';

/**
 * Single source of truth for the resource (reference-data) tables.
 *
 * The database enforces every domain rule with CHECK constraints, so these
 * definitions are not a substitute for them. They exist so the generic
 * /api/resources routes can build safe, parameterised SQL (column names can
 * never come from the request) and so the API can return a friendly error
 * before MySQL does.
 */

/** Allowed values, mirroring the CHECK constraints in 01_surgical_scheduling.sql. */
const ENUMS = {
  blood_group: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  risk_level: ['Low', 'Medium', 'High'],
  ot_status: ['Available', 'In use', 'Maintenance'],
  bed_status: ['Available', 'Occupied', 'Cleaning'],
  shift: ['Morning', 'Evening', 'Night'],
  sterile_status: ['Sterile', 'Not sterile'],
  priority: ['Routine', 'Urgent', 'Emergency'],
  surgery_status: ['Scheduled', 'Ready', 'Completed', 'Cancelled'],
  task_type: ['Test', 'Clearance', 'Consent', 'Preparation'],
  task_status: ['Pending', 'In progress', 'Completed'],
  nurse_role: ['Scrub nurse', 'Circulating nurse', 'Recovery nurse'],
  dependency_type: ['Finish-to-start', 'Start-to-start'],
};

/**
 * Resource tables exposed by /api/resources/:type.
 *
 *   key       -> the short name the frontend uses ('ot', 'procedure', ...)
 *   table     -> real MySQL table name
 *   pk        -> primary key column
 *   columns   -> writable columns, in display order
 *   enums     -> column -> ENUMS key, for validation
 *   required  -> columns that must be present on insert
 *   unique    -> columns backed by a UNIQUE constraint
 *   number    -> columns that must be coerced to numbers
 */
const RESOURCES = {
  dept: {
    table: 'Department',
    pk: 'dept_id',
    columns: ['dept_name', 'location'],
    enums: {},
    required: ['dept_name', 'location'],
    unique: ['dept_name'],
    number: [],
  },
  surgeon: {
    table: 'Surgeon',
    pk: 'surgeon_id',
    columns: ['name', 'specialization', 'phone', 'dept_id'],
    enums: {},
    required: ['name', 'specialization', 'dept_id'],
    unique: ['phone'],
    number: ['dept_id'],
  },
  anesthetist: {
    table: 'Anesthetist',
    pk: 'anesthetist_id',
    columns: ['name', 'phone', 'dept_id'],
    enums: {},
    required: ['name', 'dept_id'],
    unique: ['phone'],
    number: ['dept_id'],
  },
  patient: {
    table: 'Patient',
    pk: 'patient_id',
    columns: ['name', 'dob', 'blood_group'],
    enums: { blood_group: 'blood_group' },
    required: ['name', 'dob'],
    unique: [],
    number: [],
  },
  procedure: {
    table: 'Surgical_Procedure',
    pk: 'procedure_id',
    columns: ['procedure_name', 'est_duration_min', 'risk_level'],
    enums: { risk_level: 'risk_level' },
    required: ['procedure_name', 'est_duration_min', 'risk_level'],
    unique: ['procedure_name'],
    number: ['est_duration_min'],
  },
  ot: {
    table: 'Operating_Theatre',
    pk: 'ot_id',
    columns: ['ot_name', 'ot_type', 'status'],
    enums: { status: 'ot_status' },
    required: ['ot_name', 'ot_type'],
    unique: ['ot_name'],
    number: [],
  },
  bed: {
    table: 'Recovery_Bed',
    pk: 'bed_id',
    columns: ['ward', 'status'],
    enums: { status: 'bed_status' },
    required: ['ward'],
    unique: [],
    number: [],
  },
  nurse: {
    table: 'Nurse',
    pk: 'nurse_id',
    columns: ['name', 'shift'],
    enums: { shift: 'shift' },
    required: ['name', 'shift'],
    unique: [],
    number: [],
  },
  equipment: {
    table: 'Equipment',
    pk: 'equipment_id',
    columns: ['equipment_name', 'category', 'sterile_status'],
    enums: { sterile_status: 'sterile_status' },
    required: ['equipment_name', 'category'],
    unique: [],
    number: [],
  },
};

/**
 * The shape of the whole clinical dataset, in the same key names the original
 * frontend prototype used. The bootstrap endpoint returns one array per key
 * so the client can keep its existing rendering logic.
 */
const DATASET = [
  { key: 'dept', table: 'Department', columns: 'dept_id, dept_name, location' },
  { key: 'surgeon', table: 'Surgeon', columns: 'surgeon_id, name, specialization, phone, dept_id' },
  { key: 'anesthetist', table: 'Anesthetist', columns: 'anesthetist_id, name, phone, dept_id' },
  { key: 'patient', table: 'Patient', columns: 'patient_id, name, dob, blood_group' },
  {
    key: 'procedure',
    table: 'Surgical_Procedure',
    columns: 'procedure_id, procedure_name, est_duration_min, risk_level',
  },
  { key: 'ot', table: 'Operating_Theatre', columns: 'ot_id, ot_name, ot_type, status' },
  { key: 'bed', table: 'Recovery_Bed', columns: 'bed_id, ward, status' },
  { key: 'nurse', table: 'Nurse', columns: 'nurse_id, name, shift' },
  { key: 'equipment', table: 'Equipment', columns: 'equipment_id, equipment_name, category, sterile_status' },
  {
    key: 'surgery',
    table: 'Surgery',
    columns:
      'surgery_id, surgery_date, TIME_FORMAT(start_time, \'%H:%i\') AS start_time, ' +
      'priority, status, patient_id, procedure_id, surgeon_id, anesthetist_id, ot_id, bed_id',
  },
  {
    key: 'task',
    table: 'Pre_Op_Task',
    columns: 'task_id, task_name, task_type, status, surgery_id',
  },
  {
    key: 'surgeryNurse',
    table: 'Surgery_Nurse',
    columns: 'surgery_id, nurse_id, role',
  },
  {
    key: 'surgeryEquip',
    table: 'Surgery_Equipment',
    columns: 'surgery_id, equipment_id, quantity',
  },
  {
    key: 'taskDep',
    table: 'Task_Dependency',
    columns: 'predecessor_task_id, successor_task_id, dependency_type, lag_minutes',
  },
  {
    key: 'surgDep',
    table: 'Surgery_Dependency',
    columns: 'predecessor_surgery_id, successor_surgery_id, dependency_type',
  },
];

module.exports = { ENUMS, RESOURCES, DATASET };
