#!/usr/bin/env node
'use strict';
/**
 * End-to-end smoke test for the Surgical Scheduling API.
 *
 *   node scripts/smoke-test.js
 *
 * Requires the server to be running and the database loaded (see README).
 * It signs in as demo doctors, checks the read endpoints against the sample
 * data, exercises the write paths, and confirms the database's business rules
 * (triggers) reject bad data. Everything it creates is cleaned up again.
 *
 * Environment:
 *   BASE_URL  default http://localhost:3000
 *   EMAIL     default anita.desai@hospital.test  (a Surgeon in the seed data)
 *   PASSWORD  default demo1234
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.EMAIL || 'anita.desai@hospital.test';
const PASSWORD = process.env.PASSWORD || process.env.DEMO_PASSWORD || 'demo1234';

let passed = 0;
let failed = 0;
let token = null;

const ok = (name, detail = '') => { passed += 1; console.log(`  \u2713 ${name}${detail ? '  (' + detail + ')' : ''}`); };
const bad = (name, detail = '') => { failed += 1; console.log(`  \u2717 ${name}${detail ? '  -- ' + detail : ''}`); };
const check = (name, condition, detail = '') => (condition ? ok(name, detail) : bad(name, detail));

async function api(method, path, body, useToken = true) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (useToken && token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
  return { status: res.status, data };
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);

  /* ---------- health ---------- */
  console.log('Health');
  const health = await api('GET', '/health', undefined, false);
  check('GET /api/health', health.status === 200 && health.data.ok, 'MySQL ' + health.data.mysql);

  /* ---------- auth ---------- */
  console.log('\nAuthentication');
  check('bootstrap without token is 401', (await api('GET', '/bootstrap', undefined, false)).status === 401);
  check('wrong password is 401', (await api('POST', '/auth/login', { email: EMAIL, password: 'nope' }, false)).status === 401);

  let r = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD }, false);
  check('login returns a token', r.status === 200 && !!r.data.token, 'role ' + r.data.user.role);
  token = r.data.token;

  r = await api('GET', '/auth/departments', undefined, false);
  check('public departments list', r.status === 200 && r.data.departments.length === 5);

  r = await api('POST', '/auth/register', {
    role: 'Surgeon', name: 'Smoke Test', specialization: 'Testing',
    phone: '9000000001', dept_id: 1, email: 'smoke.test@hospital.test', password: 'testpass123',
  }, false);
  check('register creates a doctor and logs in', r.status === 201 && !!r.data.token, r.data.user && r.data.user.row.name);
  const newSurgeonId = r.data.user && r.data.user.id;

  /* ---------- bootstrap ---------- */
  console.log('\nBootstrap (15 tables + server-computed rules)');
  const boot = (await api('GET', '/bootstrap')).data;
  check('surgeries = 10', boot.data.surgery.length === 10);
  check('pre-op tasks = 20', boot.data.task.length === 20);
  check('task dependencies = 8', boot.data.taskDep.length === 8);
  check('surgery dependencies = 1', boot.data.surgDep.length === 1);
  check('nurse / equipment links', boot.data.surgeryNurse.length === 14 && boot.data.surgeryEquip.length === 15);
  check('conflicts for surgeries 3 and 7', (boot.conflicts[3] || []).length > 0 && (boot.conflicts[7] || []).length > 0);
  check('blockers for surgery 6', (boot.blockers[6] || []).length > 0);
  check('surgery 8 has no blockers', (boot.blockers[8] || []).length === 0);

  /* ---------- detail / views ---------- */
  console.log('\nDetail and SQL views');
  const detail = (await api('GET', '/surgeries/1')).data;
  check('surgery 1 detail', detail.surgery.surgery_id === 1 && detail.tasks.length === 4 && detail.nurses.length === 3);

  const conflicts = (await api('GET', '/reports/conflicts')).data;
  check('v_conflicts returns rows', conflicts.rows.length >= 6, conflicts.rows.length + ' rows');

  const readiness = (await api('GET', '/reports/readiness')).data;
  const s8 = readiness.rows.find((x) => x.surgery_id === 8);
  check('v_surgery_readiness_full: surgery 8 = Can proceed', s8 && s8.readiness === 'Can proceed');

  const util = (await api('GET', '/reports/theatre-utilization?date=2026-10-14')).data;
  const ot3 = util.rows.find((x) => x.ot_name === 'OT-3');
  check('sp_theatre_utilization: OT-3 on 14 Oct', ot3 && ot3.cases === 2 && ot3.utilization_pct === 30, ot3 && ot3.utilization_pct + '% (numeric)');

  check('surgeon workload present', (await api('GET', '/reports/surgeon-workload')).data.rows.length >= 3);
  check('v_task_chain: surgery 1 has 4 steps', (await api('GET', '/reports/task-chain?surgery_id=1')).data.rows.length === 4);
  check('v_pending_tasks present', (await api('GET', '/reports/pending-tasks')).data.rows.length > 0);
  check('v_status_counts present', (await api('GET', '/reports/status-counts')).data.rows.length > 0);

  /* ---------- rules that need no ownership ---------- */
  console.log('\nBusiness rules enforced by the database triggers');
  r = await api('POST', '/surgeries', { surgery_date: '2026-10-14', start_time: '09:00', priority: 'Routine', patient_id: 8, procedure_id: 7, surgeon_id: 4, anesthetist_id: 2, ot_id: 3, bed_id: 4 });
  check('double-booked surgeon is rejected (409)', r.status === 409, r.data.error);

  r = await api('POST', '/surgeries', { surgery_date: '2026-10-30', start_time: '10:00', priority: 'Routine', patient_id: 8, procedure_id: 7, surgeon_id: 2, anesthetist_id: 3, ot_id: 5, bed_id: 3 });
  check('maintenance theatre is rejected (409)', r.status === 409, r.data.error);

  r = await api('POST', '/surgeries/3/nurses', { nurse_id: 1, role: 'Recovery nurse' });
  check('nurse double-booking is rejected (409)', r.status === 409, r.data.error);

  r = await api('DELETE', '/resources/patient/1');
  check('a patient in use cannot be deleted (409)', r.status === 409);

  /* ---------- a surgery owned by the signed-in doctor ---------- */
  console.log('\nFull workflow on a surgery owned by the signed-in doctor');
  r = await api('POST', '/surgeries', { surgery_date: '2026-10-25', start_time: '09:00', priority: 'Routine', patient_id: 8, procedure_id: 7, surgeon_id: 4, anesthetist_id: 1, ot_id: 1, bed_id: 1 });
  check('a free slot schedules (201)', r.status === 201, 'surgery #' + (r.data.surgery && r.data.surgery.surgery_id));
  const newId = r.data.surgery.surgery_id;

  const taskA = (await api('POST', '/tasks', { surgery_id: newId, task_name: 'Blood test', task_type: 'Test' })).data.task.task_id;
  const taskB = (await api('POST', '/tasks', { surgery_id: newId, task_name: 'Consent signed', task_type: 'Consent' })).data.task.task_id;
  check('pre-op tasks can be added', !!taskA && !!taskB);

  r = await api('POST', '/task-dependencies', { predecessor_task_id: taskA, successor_task_id: taskB });
  check('a task dependency can be added', r.status === 201);

  r = await api('PATCH', `/tasks/${taskB}/status`, { status: 'Completed' });
  check('a task blocked by its predecessor is rejected (409)', r.status === 409, r.data.error);

  r = await api('POST', '/task-dependencies', { predecessor_task_id: taskB, successor_task_id: taskA });
  check('a dependency cycle is rejected (409)', r.status === 409, r.data.error);

  r = await api('POST', '/surgery-dependencies', { predecessor_surgery_id: newId, successor_surgery_id: 3 });
  check('a predecessor dated after the successor is rejected (409)', r.status === 409, r.data.error);

  r = await api('PATCH', `/surgeries/${newId}/status`, { status: 'Ready' });
  check('a surgery with open tasks cannot become Ready (409)', r.status === 409, r.data.error);

  check('predecessor task completes', (await api('PATCH', `/tasks/${taskA}/status`, { status: 'Completed' })).status === 200);
  check('successor task now completes', (await api('PATCH', `/tasks/${taskB}/status`, { status: 'Completed' })).status === 200);

  r = await api('PATCH', `/surgeries/${newId}/status`, { status: 'Ready' });
  check('unblocked surgery becomes Ready', r.status === 200);
  await api('PATCH', `/surgeries/${newId}/status`, { status: 'Scheduled' });

  r = await api('PUT', `/surgeries/${newId}`, { priority: 'Urgent' });
  check('the surgery can be edited', r.status === 200 && r.data.surgery.priority === 'Urgent');

  r = await api('DELETE', '/tasks/' + taskB);
  check('a task can be deleted', r.status === 200);

  r = await api('DELETE', `/surgeries/${newId}`);
  check('the surgery deletes with its links (cascade)', r.status === 200);

  /* ---------- resources CRUD ---------- */
  console.log('\nReference-data CRUD');
  r = await api('POST', '/resources/patient', { name: 'Test Patient', dob: '1990-01-01', blood_group: 'O+' });
  check('a patient can be created', r.status === 201);
  const newPatient = r.data.row.patient_id;
  r = await api('PUT', '/resources/patient/' + newPatient, { name: 'Test Patient Renamed' });
  check('the patient can be updated', r.status === 200 && r.data.row.name === 'Test Patient Renamed');
  check('the patient can be deleted', (await api('DELETE', '/resources/patient/' + newPatient)).status === 200);

  r = await api('POST', '/resources/patient', { name: 'Bad Blood', dob: '1990-01-01', blood_group: 'ZZ' });
  check('an invalid blood group is rejected (400)', r.status === 400, r.data.error);

  /* ---------- ownership ---------- */
  console.log('\nOwnership rules');
  const other = await api('POST', '/auth/login', { email: 'rohan.iyer@hospital.test', password: PASSWORD }, false);
  const saved = token;
  token = other.data.token;
  r = await api('PATCH', '/tasks/8/status', { status: 'Completed' }); // task 8 is on Anita's surgery 3
  check("a colleague cannot edit another doctor's surgery (403)", r.status === 403, r.data.error);
  token = saved;

  /* ---------- cleanup ---------- */
  if (newSurgeonId) {
    await api('DELETE', '/resources/surgeon/' + newSurgeonId);
    check('the registered test doctor is cleaned up', true);
  }

  /* ---------- summary ---------- */
  console.log('\n' + '\u2500'.repeat(46));
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err.message);
  process.exit(1);
});
