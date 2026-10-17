/* =====================================================================
   Surgical Scheduling and Dependency Management - Review 3 frontend
   The layout, styling and flows are the original prototype's. The data
   layer now talks to the Express + MySQL backend instead of localStorage:
     - a JWT is kept in localStorage,
     - GET /api/bootstrap fills the in-memory mirror `db`,
     - every write is a REST call, then the mirror is refreshed,
     - conflicts and blockers come from the SQL views (server-computed).
   ===================================================================== */
const R = ['Pending', 'In progress', 'Completed'];
const ST = ['Scheduled', 'Ready', 'Completed', 'Cancelled'];
const NR = ['Scrub nurse', 'Circulating nurse', 'Recovery nurse'];
const TBL = {
  dept: 'Department', surgeon: 'Surgeon', anesthetist: 'Anesthetist', patient: 'Patient',
  procedure: 'Procedure', ot: 'Operating_Theatre', bed: 'Recovery_Bed', nurse: 'Nurse', equipment: 'Equipment',
};
const RL = {
  dept: 'Departments', surgeon: 'Surgeons', anesthetist: 'Anesthetists', patient: 'Patients',
  procedure: 'Procedures', ot: 'Theatres', bed: 'Recovery beds', nurse: 'Nurses', equipment: 'Equipment',
};
const LB = {
  dept: 'Department', ot: 'Operating theatre', bed: 'Recovery bed', est_duration_min: 'Estimated duration (min)',
  dob: 'Date of birth', ot_name: 'Theatre name', ot_type: 'Theatre type', blood_group: 'Blood group',
  risk_level: 'Risk level', sterile_status: 'Sterile status', surgery_date: 'Date', start_time: 'Start time',
  procedure_name: 'Procedure name', equipment_name: 'Equipment name', dept_name: 'Department name',
};
const S = {
  dept: { pk: 'dept_id', n: (r) => r.dept_name, f: { dept_name: 'text', location: 'text' } },
  surgeon: { pk: 'surgeon_id', n: (r) => r.name, f: { name: 'text', specialization: 'text', phone: 'tel', dept_id: '@dept' } },
  anesthetist: { pk: 'anesthetist_id', n: (r) => r.name, f: { name: 'text', phone: 'tel', dept_id: '@dept' } },
  patient: { pk: 'patient_id', n: (r) => r.name, f: { name: 'text', dob: 'date', blood_group: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'] } },
  procedure: { pk: 'procedure_id', n: (r) => r.procedure_name, f: { procedure_name: 'text', est_duration_min: 'number', risk_level: ['Low', 'Medium', 'High'] } },
  ot: { pk: 'ot_id', n: (r) => r.ot_name, f: { ot_name: 'text', ot_type: 'text', status: ['Available', 'In use', 'Maintenance'] } },
  bed: { pk: 'bed_id', n: (r) => 'Bed ' + r.bed_id + ' (' + r.ward + ')', f: { ward: 'text', status: ['Available', 'Occupied', 'Cleaning'] } },
  nurse: { pk: 'nurse_id', n: (r) => r.name, f: { name: 'text', shift: ['Morning', 'Evening', 'Night'] } },
  equipment: { pk: 'equipment_id', n: (r) => r.equipment_name, f: { equipment_name: 'text', category: 'text', sterile_status: ['Sterile', 'Not sterile'] } },
  surgery: {
    pk: 'surgery_id',
    n: (r) => '#' + r.surgery_id,
    f: {
      patient_id: '@patient', procedure_id: '@procedure', surgeon_id: '@surgeon', anesthetist_id: '@anesthetist',
      ot_id: '@ot', bed_id: '@bed', surgery_date: 'date', start_time: 'time',
      priority: ['Routine', 'Urgent', 'Emergency'],
    },
  },
  task: { pk: 'task_id', n: (r) => r.task_name, f: { surgery_id: '@surgery' } },
};
const RES = Object.keys(TBL);

/* ---- live data mirror, filled from the API ---- */
const emptyDb = () => ({
  dept: [], surgeon: [], anesthetist: [], patient: [], procedure: [], ot: [], bed: [], nurse: [], equipment: [],
  surgery: [], task: [], taskDep: [], surgDep: [], surgeryNurse: [], surgeryEquip: [],
  conflicts: {}, blockers: {}, readiness: [],
});
let db = emptyDb();
let CURRENT = null; // the signed-in doctor, or null

const st = {
  tab: 'bookings', view: 'list', sel: null, scope: 'mine', q: '', fs: '', fd: '',
  showCf: false, cfScope: 'mine', modal: null, formErr: '', cdel: null,
  res: 'surgeon', redit: null, rdate: '2026-10-14', mdate: '2026-10-14',
  auth: 'in', suRole: 'Surgeon', sv: {}, liEmail: '', authErr: '',
};

/* ---- helpers ---- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const get = (t, id) => db[t].find((r) => r[S[t].pk] === id);
const lab = (t, id) => { const r = get(t, id); return r ? S[t].n(r) : '?'; };
const tm = (s) => { const [h, m] = s.start_time.split(':'); return +h * 60 + +m; };
const dur = (s) => (get('procedure', s.procedure_id) || { est_duration_min: 0 }).est_duration_min;
const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const span = (s) => [tm(s), tm(s) + dur(s)];
const active = (s) => s.status == 'Scheduled' || s.status == 'Ready';
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/* Server-computed rule state (SQL views v_conflicts / v_surgery_blockers). */
const conflicts = (s) => db.conflicts[s.surgery_id] || [];
const blockers = (s) => db.blockers[s.surgery_id] || [];

const toast = (m, bad) => {
  const t = $('#toast'); t.textContent = m; t.className = bad ? 'bad' : ''; t.style.display = 'block';
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = 'none'), 4600);
};
const fdata = (f, sp) => {
  const o = {};
  for (const k in sp) {
    let v = f.elements[k].value.trim ? f.elements[k].value.trim() : f.elements[k].value;
    const p = sp[k];
    if (p == 'number' || (typeof p == 'string' && p[0] == '@')) v = +v;
    o[k] = v;
  }
  return o;
};
const opts = (rows, fn, sel) => rows.map((r) => `<option value="${fn[0](r)}" ${fn[0](r) == sel ? 'selected' : ''}>${esc(fn[1](r))}</option>`).join('');
const eo = (a, sel) => a.map((o) => `<option ${o == sel ? 'selected' : ''}>${o}</option>`).join('');
const nice = (k) => LB[k] || LB[k.replace(/_id$/, '')] || (k.replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));

function inp(k, p, v = '') {
  const l = nice(k); let c;
  if (Array.isArray(p)) c = `<select name="${k}">${eo(p, v)}</select>`;
  else if (p[0] == '@') { const t = p.slice(1); c = `<select name="${k}">${opts(db[t], [(r) => r[S[t].pk], (r) => S[t].n(r)], v)}</select>`; }
  else if (p == 'tel') c = `<input name="${k}" type="tel" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" title="10 digits" value="${esc(v)}" required>`;
  else c = `<input name="${k}" type="${p}" value="${esc(v)}" required ${p == 'number' ? 'min=1' : ''} ${k == 'dob' ? 'min=1900-01-01' : ''}>`;
  return `<label>${l}${c}</label>`;
}
const badge = (s) => `<span class="b ${{ Scheduled: 'sched', Ready: 'ready', Completed: 'done', Cancelled: 'canc' }[s]}">${s}</span>`;

/* ---- who is signed in ---- */
const me = () => CURRENT;
const mine = (s) => { const u = me(); return !!u && s[u.key] == u.id; };
const initials = (n) => n.replace(/^Dr\.\s*/, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/* ---- data loading ---- */
async function reload() {
  const snap = await API.bootstrap();
  CURRENT = snap.user;
  for (const k of Object.keys(snap.data)) db[k] = snap.data[k];
  db.conflicts = snap.conflicts || {};
  db.blockers = snap.blockers || {};
  db.readiness = snap.readiness || [];
}
async function loadPublicDepartments() {
  try {
    const { departments } = await API.get('/auth/departments');
    db.dept = departments || [];
  } catch (e) { /* the sign-in screen still works without the dropdown */ }
}
async function signIn(email, password) {
  const { token } = await API.login(email, password);
  API.setToken(token);
  await reload();
  st.auth = 'in'; st.authErr = ''; st.sv = {}; st.liEmail = '';
  st.scope = 'mine'; st.showCf = false; st.cfScope = 'mine';
}

/* ---- routing (hash based, so the browser Back button works) ---- */
const TABS = [['bookings', 'Bookings'], ['map', 'Theatre map'], ['resources', 'Resources'], ['reports', 'Reports']];
function parse() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  const t = h[0] || 'bookings';
  st.tab = TABS.some((x) => x[0] == t) ? t : 'bookings';
  if (st.tab == 'bookings' && h[1] && get('surgery', +h[1])) { st.view = 'surgery'; st.sel = +h[1]; }
  else { st.view = 'list'; }
}
function nav(h) {
  if (location.hash == h) { parse(); render(); }
  else location.hash = h;
}
addEventListener('hashchange', () => { parse(); st.modal = null; st.cdel = null; render(); scrollTo(0, 0); });

/* ---- views ---- */
function header(u) {
  return `<header class="top"><div class="brand"><span class="logo" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M8 2h4v6h6v4h-6v6H8v-6H2V8h6z" fill="currentColor"/></svg></span><div><b>Surgical Scheduling</b><small>&amp; Dependency Management</small></div></div>
${u ? `<nav class="tabs" aria-label="Main">${TABS.map(([k, l]) => `<button data-a="tab" data-v="${k}" ${st.tab == k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>
<div class="who"><span class="nm"><b>${esc(u.row.name)}</b><small>${u.role}</small></span><span class="av" aria-hidden="true">${initials(u.row.name)}</span><button class="btn sm onbar" data-a="signout">Sign out</button></div>` : '<span></span><span></span>'}</header>`;
}

function vAuth() {
  const up = st.auth == 'up', v = st.sv || {}, isS = st.suRole == 'Surgeon';
  const fld = (n, l, t, val, x = '') => `<label>${l}<input name="${n}" type="${t}" value="${esc(val || '')}" ${x}></label>`;
  const demos = [
    ['anita.desai@hospital.test', 'Dr. Anita Desai', 'Surgeon, has 2 conflicts'],
    ['rohan.iyer@hospital.test', 'Dr. Rohan Iyer', 'Surgeon, has 1 conflict'],
    ['kavita.menon@hospital.test', 'Dr. Kavita Menon', 'Anesthetist'],
  ];
  const form = up ? `<form data-f="su" class="form" novalidate>
<div><div class="mu" style="font-size:13px;font-weight:600;margin-bottom:4px">I am a</div><div class="seg" role="group" aria-label="Role">${['Surgeon', 'Anesthetist'].map((r) => `<button type="button" data-a="surole" data-v="${r}" aria-pressed="${st.suRole == r}">${r}</button>`).join('')}</div></div>
${fld('name', 'Full name', 'text', v.name, 'placeholder="Dr. Full Name" autocomplete="name" required')}
${isS ? fld('specialization', 'Specialization', 'text', v.specialization, 'placeholder="e.g. Cardiac surgery" required') : ''}
<div class="grid" style="align-items:start">${fld('phone', 'Phone (10 digits)', 'tel', v.phone, 'inputmode="numeric" maxlength="10" autocomplete="tel" required')}
<label>Department<select name="dept_id">${opts(db.dept, [(r) => r.dept_id, (r) => r.dept_name], v.dept_id)}</select></label></div>
${fld('email', 'Email', 'email', v.email, 'autocomplete="email" required')}
<div class="grid" style="align-items:start">${fld('password', 'Password (8+ characters)', 'password', '', 'autocomplete="new-password" required')}${fld('password2', 'Confirm password', 'password', '', 'autocomplete="new-password" required')}</div>
<button class="btn pri">Create account</button></form>`
    : `<form data-f="li" class="form" novalidate>${fld('email', 'Email', 'email', st.liEmail, 'autocomplete="email" required')}${fld('password', 'Password', 'password', '', 'autocomplete="current-password" required')}<button class="btn pri">Sign in</button>
<div><div class="mu" style="font-size:13px;margin-bottom:6px">Demo accounts (password <code class="t">demo1234</code>)</div><div class="demo">${demos.map((d) => `<button type="button" class="btn sm" data-a="demo" data-email="${d[0]}" title="${d[2]}">${d[1]}</button>`).join('')}</div></div></form>`;
  return `<div class="authwrap"><div><h1>Plan surgeries without the surprises</h1><p class="mu" style="font-size:17px;margin:0">Sign in to see your own bookings, spot double bookings early, and keep every pre-op task on track.</p>
<ul class="pts"><li><i style="background:var(--beryl)">1</i><span><b>Your bookings first.</b><br><span class="mu">Clear ones on top, clashes underneath.</span></span></li><li><i style="background:var(--bluebell)">2</i><span><b>See exactly what conflicts.</b><br><span class="mu">Staff, theatre, bed, nurse or equipment.</span></span></li><li><i style="background:var(--mauve)">3</i><span><b>Nothing goes ahead half-ready.</b><br><span class="mu">Tests, clearances and consent are tracked as a chain.</span></span></li></ul></div>
<div class="card" style="margin:0"><div class="seg" role="tablist" style="margin-bottom:16px"><button data-a="authtab" data-v="in" aria-pressed="${!up}">Sign in</button><button data-a="authtab" data-v="up" aria-pressed="${up}">Sign up</button></div>
${st.authErr ? `<div class="err" role="alert">${esc(st.authErr)}</div>` : ''}${form}</div></div>`;
}

/* first page */
const myRows = () => { const u = me(); return db.surgery.filter((s) => s[u.key] == u.id); };
const byTime = (a, b) => (a.surgery_date + a.start_time).localeCompare(b.surgery_date + b.start_time);
function cfRows(scope) {
  const u = me();
  return db.surgery
    .filter((s) => active(s) && (scope == 'all' || s[u.key] == u.id))
    .sort(byTime)
    .map((s) => [s, conflicts(s)])
    .filter((x) => x[1].length);
}
function scanCard() {
  const rows = cfRows(st.cfScope), sc = st.cfScope == 'mine' ? 'your surgeries' : 'all surgeries';
  return `<div class="card" id="scan" style="scroll-margin-top:84px"><div class="cardhead"><h2>Conflict scan (${sc})</h2><div class="seg" role="group" aria-label="Scan scope"><button data-a="cfscope" data-v="mine" aria-pressed="${st.cfScope == 'mine'}">Mine</button><button data-a="cfscope" data-v="all" aria-pressed="${st.cfScope == 'all'}">Everyone</button></div></div>
${rows.length ? rows.map(([s, c]) => `<div class="box er"><button class="lnk" data-a="open" data-id="${s.surgery_id}">Open surgery</button><b>Surgery #${s.surgery_id}</b>${c.map((x) => `<div>- ${esc(x)}</div>`).join('')}</div>`).join('') : '<div class="box ok">No resource conflicts found.</div>'}
<h3>Surgeries by status</h3><div class="inl">${ST.map((x) => `<span>${badge(x)} <b>${(st.cfScope == 'all' ? db.surgery : myRows()).filter((s) => s.status == x).length}</b></span>`).join('')}</div></div>`;
}
function vB() {
  if (st.view == 'surgery') return vD();
  const u = me(), my = myRows().filter(active), cfN = cfRows('mine').length,
    blk = my.filter((s) => blockers(s).filter((x) => !x.startsWith('Conflict:')).length).length, h = new Date().getHours();
  const nxt = my.slice().sort(byTime)[0];
  return `<section class="card hero"><div class="inl" style="justify-content:space-between;align-items:flex-start"><div><h1>${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${esc(u.row.name)}</h1><p>${u.role} · ${esc(lab('dept', u.row.dept_id))}${nxt ? ` · Next up: surgery #${nxt.surgery_id} on ${fmtDate(nxt.surgery_date)} at ${nxt.start_time}` : ''}</p></div><button class="btn pri" data-a="new">+ Schedule a surgery</button></div>
<div class="tiles"><div class="tile"><b>${my.length}</b><span>Active bookings</span></div><div class="tile"><b>${my.filter((s) => !conflicts(s).length).length}</b><span>Clear of conflicts</span></div>
<button class="tile" data-a="togglecf" aria-label="Show conflicting bookings"><b class="${cfN ? 'er' : ''}">${cfN}</b><span>Conflicting</span></button><div class="tile"><b>${blk}</b><span>Waiting on prerequisites</span></div></div></section>
${cfN ? `<div class="banner er" role="status"><span><b>${cfN} of your bookings ${cfN > 1 ? 'conflict' : 'conflicts'} with other surgeries.</b> <span class="mu">They are listed after your clear bookings.</span></span><button class="btn ${st.showCf ? '' : 'pri'}" data-a="togglecf" aria-expanded="${st.showCf}">${st.showCf ? 'Hide conflicts' : 'See which ones conflict'}</button></div>` : `<div class="banner ok" role="status"><span><b>None of your bookings conflict.</b> <span class="mu">Everything is clear to proceed on resources.</span></span><button class="btn" data-a="togglecf" aria-expanded="${st.showCf}">${st.showCf ? 'Hide scan' : 'Open conflict scan'}</button></div>`}
${st.showCf ? scanCard() : ''}
<div class="bar"><div class="seg" role="group" aria-label="Which surgeries"><button data-a="scope" data-v="mine" aria-pressed="${st.scope == 'mine'}">My bookings</button><button data-a="scope" data-v="all" aria-pressed="${st.scope == 'all'}">All surgeries</button></div>
<input data-k="q" placeholder="Search patient, surgeon, procedure…" value="${esc(st.q)}" style="min-width:230px;flex:1;max-width:340px" aria-label="Search"><select data-k="fs" aria-label="Status"><option value="">Any status</option>${eo(ST, st.fs)}</select><input type="date" data-k="fd" value="${st.fd}" aria-label="Date"><button class="btn sm" data-a="clearf">Clear</button></div><div id="bk"></div>`;
}
function bookingRow(s, grp, showDoc) {
  const [, b] = span(s), t = db.task.filter((x) => x.surgery_id == s.surgery_id), done = t.filter((x) => x.status == 'Completed').length,
    act = active(s), bl = act ? blockers(s).filter((x) => !x.startsWith('Conflict:')).length : 0, cf = act ? conflicts(s).length : 0, own = mine(s);
  const tags = [badge(s.status), s.priority == 'Urgent' ? '<span class="b urg">Urgent</span>' : s.priority == 'Emergency' ? '<span class="b emg">Emergency</span>' : '',
    cf ? `<button class="b cf" data-a="seecf" data-id="${s.surgery_id}" style="cursor:pointer" title="See what conflicts">Conflict ▸</button>` : '',
    act ? (bl ? `<span class="b wait">Waiting: ${t.length ? done + ' of ' + t.length + ' tasks done' : bl + ' item' + (bl > 1 ? 's' : '')}</span>` : (cf || s.status == 'Ready' ? '' : '<span class="b ready">Prerequisites done</span>')) : ''].join('');
  return `<article class="bk ${grp}"><div class="when"><b>${fmtDate(s.surgery_date)}</b><span>${s.start_time}–${hm(b)}</span></div>
<div><h3>${esc(lab('procedure', s.procedure_id))}</h3><div>${esc(lab('patient', s.patient_id))}</div><div class="meta">${lab('ot', s.ot_id)} · ${esc(lab('bed', s.bed_id))}${showDoc ? ` · ${esc(lab('surgeon', s.surgeon_id))} / ${esc(lab('anesthetist', s.anesthetist_id))}` : ''}</div><div class="tags">${tags}</div></div>
<div class="acts"><button class="btn sm pri" data-a="open" data-id="${s.surgery_id}">Open</button>${own ? (st.cdel == s.surgery_id ? `<button class="btn sm danger" data-a="sdelyes" data-id="${s.surgery_id}">Yes, delete</button><button class="btn sm" data-a="sdelno">Keep</button>` : `<button class="btn sm" data-a="sedit" data-id="${s.surgery_id}">Edit</button><button class="btn sm danger" data-a="sdel" data-id="${s.surgery_id}">Delete</button>`) : ''}</div></article>`;
}
function list() {
  const u = me(), q = st.q.toLowerCase(), showDoc = st.scope == 'all';
  const rows = db.surgery.filter((s) => (st.scope == 'all' || s[u.key] == u.id) && (!st.fs || s.status == st.fs) && (!st.fd || s.surgery_date == st.fd) &&
    (`${s.surgery_id} ${lab('patient', s.patient_id)} ${lab('procedure', s.procedure_id)} ${lab('surgeon', s.surgeon_id)}`.toLowerCase().includes(q))).sort(byTime);
  const cl = [], cf = [], cd = [];
  rows.forEach((s) => { if (!active(s)) cd.push(s); else if (conflicts(s).length) cf.push(s); else cl.push(s); });
  const sec = (title, n, arr, grp, hint) => n ? `<div class="sec"><h2>${title}</h2><span class="cnt">${n}</span><i></i></div>${hint ? `<p class="mu" style="margin:-4px 0 10px">${hint}</p>` : ''}${arr.map((s) => bookingRow(s, grp, showDoc)).join('')}` : '';
  $('#bk').innerHTML = (rows.length ? sec('Clear bookings', cl.length, cl, '', '') + sec('Bookings with conflicts', cf.length, cf, 'cf', 'Another surgery uses the same people, room, bed or equipment at the same time. Use "See which ones conflict" above for details.') + sec('Completed and cancelled', cd.length, cd, 'cd', '') : '') +
    (!rows.length ? `<div class="empty">${st.scope == 'mine' && !db.surgery.some((s) => s[u.key] == u.id) ? 'No bookings yet. Use "Schedule a surgery" to add your first one.' : 'No surgeries match these filters.'}</div>` : (!cl.length && !st.q && !st.fs && !st.fd ? `<div class="empty" style="margin-bottom:10px">No clear active bookings right now.</div>` : ''));
}

function vD() {
  const s = get('surgery', st.sel); if (!s) return '';
  const id = s.surgery_id, b = blockers(s), ro = !mine(s);
  const tasks = db.task.filter((t) => t.surgery_id == id);
  const dp = (t) => { const p = db.taskDep.filter((d) => d.successor_task_id == t.task_id); return p.length ? 1 + Math.max(...p.map((d) => dp(get('task', d.predecessor_task_id)))) : 0; };
  tasks.sort((a, b) => dp(a) - dp(b));
  const lv = []; tasks.forEach((t) => (lv[dp(t)] ??= []).push(t.task_name));
  const nu = db.surgeryNurse.filter((x) => x.surgery_id == id), eq = db.surgeryEquip.filter((x) => x.surgery_id == id),
    pr = db.surgDep.filter((d) => d.successor_surgery_id == id), su = db.surgDep.filter((d) => d.predecessor_surgery_id == id);
  const sl = (x) => `#${x} ${lab('procedure', get('surgery', x).procedure_id)} (${lab('patient', get('surgery', x).patient_id)}, ${get('surgery', x).surgery_date})`;
  const ed = (h) => (ro ? '' : h), cfl = b.filter((x) => x.startsWith('Conflict:')), oth = b.filter((x) => !x.startsWith('Conflict:'));
  return `<div class="crumbs"><button class="btn sm" data-a="back">← Back to bookings</button><span>Bookings / Surgery #${id}</span></div>
<div class="card"><div class="cardhead"><h2>Surgery #${id}: ${esc(lab('procedure', s.procedure_id))} for ${esc(lab('patient', s.patient_id))} ${badge(s.status)}</h2>${ro ? '' : `<button class="btn sm" data-a="sedit" data-id="${id}">Edit details</button>`}</div>
<div class="mu">${fmtDate(s.surgery_date)} ${s.start_time}-${hm(span(s)[1])} | ${lab('ot', s.ot_id)} | ${esc(lab('surgeon', s.surgeon_id))} | ${esc(lab('anesthetist', s.anesthetist_id))}</div>
${ro ? '<div class="box wn"><b>Read-only</b>This is a colleague\'s booking. You can see everything, but only the doctors on it can change it.</div>' : ''}
<div class="box ${b.length ? 'wn' : 'ok'}"><b>${b.length ? 'Not ready to proceed' : 'All prerequisites complete'}</b>${oth.map((x) => `<div>- ${esc(x)}</div>`).join('')}${!oth.length && cfl.length ? '<div>- Resolve the conflicts below first</div>' : ''}</div>
${cfl.length ? `<div class="box er"><b>Conflicts</b>${cfl.map((x) => `<div>- ${esc(x.replace(/^Conflict: /, ''))}</div>`).join('')}</div>` : ''}
<div class="inl" style="margin-top:12px"><span class="mu" style="font-weight:600">Status</span><div class="seg" role="group" aria-label="Status">${ST.map((v) => `<button data-a="status" data-v="${v}" aria-pressed="${s.status == v}" ${ro ? 'disabled' : ''}>${v}</button>`).join('')}</div></div></div>
<div class="two"><div class="card"><h2>Pre-operative tasks and dependency chain</h2><div class="mu">Chain: ${lv.length ? esc(lv.map((l) => l.join(' + ')).join(' → ')) + ' → Surgery' : 'no tasks yet'}</div><div style="margin-top:10px">
${tasks.map((t) => {
    const pd = db.taskDep.filter((d) => d.successor_task_id == t.task_id), av = tasks.filter((o) => o.task_id != t.task_id && !pd.some((d) => d.predecessor_task_id == o.task_id));
    return `<div class="trow"><div class="inl"><b>${dp(t) + 1}. ${esc(t.task_name)}</b><span class="mu">${t.task_type}</span><select data-c="tstat" data-id="${t.task_id}" aria-label="Status of ${esc(t.task_name)}" ${ro ? 'disabled' : ''}>${eo(R, t.status)}</select>${ed(`<button class="btn sm danger" data-a="tdel" data-id="${t.task_id}">Delete</button>`)}</div>
<div>${pd.length ? 'After: ' : '<span class="mu">No predecessors</span>'}${pd.map((d) => `<span class="chip">${esc(lab('task', d.predecessor_task_id))} (${d.dependency_type == 'Start-to-start' ? 'SS' : 'FS'}${d.lag_minutes ? ', +' + d.lag_minutes + 'm' : ''})${ed(`<button data-a="pdel" data-p="${d.predecessor_task_id}" data-s="${t.task_id}" aria-label="Remove predecessor">×</button>`)}</span>`).join('')}</div>
${av.length ? ed(`<form data-f="pf" data-id="${t.task_id}" class="inl"><select name="pred" aria-label="Predecessor">${opts(av, [(r) => r.task_id, (r) => r.task_name])}</select><select name="type" aria-label="Type"><option>Finish-to-start</option><option>Start-to-start</option></select><input name="lag" type="number" min="0" value="0" title="lag minutes" aria-label="Lag minutes"><button class="btn sm">+ Predecessor</button></form>`) : ''}</div>`;
  }).join('') || '<div class="mu">No tasks yet.</div>'}</div>
${ed(`<form data-f="tf" class="inl"><input name="task_name" placeholder="New task name" required style="min-width:160px;flex:1" aria-label="New task name"><select name="task_type" aria-label="Task type">${eo(['Test', 'Clearance', 'Consent', 'Preparation'])}</select><button class="btn pri">Add task</button></form>`)}</div>
<div class="card"><h2>Team, equipment and links</h2><h3 style="margin-top:0">Nurses</h3>${nu.map((x) => `<span class="chip">${esc(lab('nurse', x.nurse_id))} (${esc(x.role)})${ed(`<button data-a="nrm" data-id="${x.nurse_id}" aria-label="Remove nurse">×</button>`)}</span>`).join('') || '<div class="mu">None assigned</div>'}
${ed(`<form data-f="nf" class="inl"><select name="nurse" aria-label="Nurse">${opts(db.nurse, [(r) => r.nurse_id, (r) => r.name + ' (' + r.shift + ')'])}</select><select name="role" aria-label="Role">${eo(NR)}</select><button class="btn sm pri">Assign</button></form>`)}
<h3>Equipment</h3>${eq.map((x) => `<span class="chip">${esc(lab('equipment', x.equipment_id))} x${x.quantity} <span class="${get('equipment', x.equipment_id).sterile_status == 'Sterile' ? 'ok' : 'er'}">${get('equipment', x.equipment_id).sterile_status}</span>${ed(`<button data-a="erm" data-id="${x.equipment_id}" aria-label="Remove equipment">×</button>`)}</span>`).join('') || '<div class="mu">None assigned</div>'}
${ed(`<form data-f="ef" class="inl"><select name="eq" aria-label="Equipment">${opts(db.equipment, [(r) => r.equipment_id, (r) => r.equipment_name])}</select><input name="qty" type="number" min="1" value="1" aria-label="Quantity"><button class="btn sm pri">Assign</button></form>`)}
<h3>Surgery dependencies</h3><div>Depends on: ${pr.map((d) => `<span class="chip">${esc(sl(d.predecessor_surgery_id))} [${d.dependency_type}]${ed(`<button data-a="sdrm" data-p="${d.predecessor_surgery_id}" data-s="${id}" aria-label="Remove dependency">×</button>`)}</span>`).join('') || '<span class="mu">none</span>'}</div>
<div>Blocks: ${su.map((d) => `<span class="chip">${esc(sl(d.successor_surgery_id))}</span>`).join('') || '<span class="mu">none</span>'}</div>
${ed(`<form data-f="df" class="inl" style="margin-top:8px"><select name="pred" aria-label="Predecessor surgery">${opts(db.surgery.filter((o) => o.surgery_id != id && !pr.some((d) => d.predecessor_surgery_id == o.surgery_id)), [(r) => r.surgery_id, (r) => sl(r.surgery_id)])}</select><select name="type" aria-label="Type"><option>Finish-to-start</option><option>Start-to-start</option></select><button class="btn sm pri">Add predecessor</button></form>`)}</div></div>`;
}

function vM() {
  const D = st.mdate, day = db.surgery.filter((s) => s.surgery_date == D && s.status != 'Cancelled'), sl = [];
  for (let m = 480; m < 1080; m += 30) sl.push(m);
  const rows = db.ot.map((o) => {
    const mt = o.status == 'Maintenance';
    return `<div class="mrow ${mt ? 'maint' : ''}"><div class="mlab"><b>${esc(o.ot_name)}</b><small>${o.ot_type}${mt ? ' · maintenance' : ''}</small></div><div class="mtrack">${sl.map((m) => `<button class="slot" ${mt ? 'disabled' : ''} data-a="slot" data-ot="${o.ot_id}" data-t="${hm(m)}" title="Book ${esc(o.ot_name)} at ${hm(m)}" aria-label="Book ${esc(o.ot_name)} at ${hm(m)}"></button>`).join('')}${(() => {
      const ds = day.filter((s) => s.ot_id == o.ot_id).sort(byTime), ln = [], ends = [];
      ds.forEach((s, i) => { let l = 0; while (ends[l] !== undefined && ends[l] > span(s)[0]) l++; ends[l] = span(s)[1]; ln[i] = l; });
      const L = Math.max(1, ends.length);
      return ds.map((s, i) => { const [a, b] = span(s), l = Math.max(a, 480), r = Math.min(b, 1080), c = active(s) && conflicts(s).length; return `<button class="blk ${s.status} ${s.priority}" style="left:${(l - 480) / 6}%;width:${(r - l) / 6}%;top:calc(${ln[i] * 100 / L}% + 3px);bottom:calc(${(L - 1 - ln[i]) * 100 / L}% + 3px)" data-a="open" data-id="${s.surgery_id}" title="Open surgery #${s.surgery_id}: ${esc(lab('procedure', s.procedure_id))}, ${esc(lab('patient', s.patient_id))}, ${s.start_time}-${hm(b)}">${c ? '⚠ ' : ''}${mine(s) ? '★ ' : ''}#${s.surgery_id} ${esc(lab('procedure', s.procedure_id))}${L > 1 ? '' : `<small>${esc(lab('patient', s.patient_id))} · ${s.start_time}-${hm(b)}</small>`}</button>`; }).join('');
    })()}</div></div>`;
  }).join('');
  return `<div class="card"><h2>Operating theatre map</h2><div class="bar"><input type="date" data-k="mdate" value="${D}" aria-label="Date"><span class="mu">Click an empty slot to book it. Click a bar to open that surgery. ★ = yours, ⚠ = conflict.</span></div>
<div class="lg"><span><i style="background:var(--bluebell)"></i>Scheduled</span><span><i style="background:var(--duck)"></i>Ready</span><span><i style="background:var(--venus)"></i>Completed</span><span><i style="outline:2px solid var(--wn)"></i>Urgent</span><span><i style="outline:2px solid var(--er)"></i>Emergency</span><span><i style="background:var(--bd)"></i>Maintenance</span></div>
<div class="sc"><div class="mgrid"><div class="mrow mhead"><div class="mlab"></div><div class="mtrack">${[8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => `<span>${h}:00</span>`).join('')}</div></div>${rows}</div></div></div>
<div class="card"><h2>Recovery beds on ${fmtDate(D)}</h2><div class="beds">${db.bed.map((b) => { const u = day.filter((s) => s.bed_id == b.bed_id); return `<div class="bed ${u.length ? 'occ' : 'free'}"><b>Bed ${b.bed_id}</b><small>${esc(b.ward)}</small>${u.length ? u.map((s) => `<div>${esc(lab('patient', s.patient_id))}<br>from ${hm(span(s)[1])} (surgery #${s.surgery_id})</div>`).join('') : '<div class="ok">Free</div>'}</div>`; }).join('')}</div></div>`;
}

function vR() {
  const t = st.res, sp = S[t].f, e = st.redit ? get(t, st.redit) : {};
  return `<div class="bar"><div class="seg" role="group" aria-label="Resource type">${RES.map((r) => `<button data-a="rtab" data-v="${r}" aria-pressed="${r == t}">${RL[r]}</button>`).join('')}</div></div>
<div class="card"><h2>${st.redit ? 'Edit' : 'Add'} ${RL[t].toLowerCase().replace(/s$/, '')} <code class="t">${TBL[t]}</code></h2><form data-f="rf" class="grid">${Object.entries(sp).map(([k, p]) => inp(k, p, e[k])).join('')}<span class="inl"><button class="btn pri">${st.redit ? 'Save' : 'Add'}</button>${st.redit ? '<button type="button" class="btn" data-a="rcancel">Cancel</button>' : ''}</span></form></div>
<div class="card sc"><table><thead><tr><th>${S[t].pk}</th>${Object.keys(sp).map((k) => `<th>${k}</th>`).join('')}<th></th></tr></thead><tbody>${db[t].map((r) => `<tr><td>${r[S[t].pk]}</td>${Object.entries(sp).map(([k, p]) => `<td>${esc(typeof p == 'string' && p[0] == '@' ? lab(p.slice(1), r[k]) : r[k])}</td>`).join('')}<td><span class="inl"><button class="btn sm" data-a="redit" data-id="${r[S[t].pk]}">Edit</button><button class="btn sm danger" data-a="rdel" data-id="${r[S[t].pk]}">Delete</button></span></td></tr>`).join('')}</tbody></table></div>`;
}

function vP() {
  const ds = [...new Set(db.surgery.map((s) => s.surgery_date))].sort(), today = db.surgery.filter((s) => s.surgery_date == st.rdate && s.status != 'Cancelled');
  const pend = db.surgery.filter((s) => !['Completed', 'Cancelled'].includes(s.status)).map((s) => [s, db.task.filter((t) => t.surgery_id == s.surgery_id && t.status != 'Completed')]).sort((a, b) => b[1].length - a[1].length);
  const wl = db.surgeon.map((sg) => { const c = db.surgery.filter((s) => s.surgeon_id == sg.surgeon_id && s.status != 'Cancelled'), m = c.map(dur); return { n: sg.name, c: c.length, sum: m.reduce((a, b) => a + b, 0), avg: m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : 0, max: Math.max(0, ...m) }; }).filter((x) => x.c).sort((a, b) => b.sum - a.sum || a.n.localeCompare(b.n));
  return `<div class="two"><div class="card"><h2>Theatre utilization (08:00-18:00)</h2><div class="bar"><select data-k="rdate" aria-label="Date">${eo(ds, st.rdate)}</select></div><div class="sc"><table style="min-width:0"><thead><tr><th>Theatre</th><th>Cases</th><th>Booked</th><th>Utilization</th></tr></thead><tbody>${db.ot.map((o) => { const c = today.filter((s) => s.ot_id == o.ot_id), m = c.reduce((a, s) => a + dur(s), 0), p = Math.min(100, Math.round(m / 6)); return `<tr><td>${o.ot_name} <span class="mu">${o.status == 'Maintenance' ? '(maintenance)' : ''}</span></td><td>${c.length}</td><td>${m} min</td><td><div class="meter"><i style="width:${p}%"></i></div>${p}%</td></tr>`; }).join('')}</tbody></table></div></div>
<div class="card"><h2>Surgeon workload</h2><p class="mu" style="margin-top:-6px">Same idea as the GROUP BY query in Review 2.</p><div class="sc"><table style="min-width:0"><thead><tr><th>Surgeon</th><th>Surgeries</th><th>Minutes</th><th>Average</th><th>Longest</th></tr></thead><tbody>${wl.map((x) => `<tr><td>${esc(x.n)}</td><td>${x.c}</td><td>${x.sum}</td><td>${x.avg}</td><td>${x.max}</td></tr>`).join('')}</tbody></table></div></div></div>
<div class="card sc"><h2>Pending tasks per surgery</h2><table><thead><tr><th>Surgery</th><th>Date</th><th>Open tasks</th><th>Tasks</th></tr></thead><tbody>${pend.map(([s, t]) => `<tr><td><button class="lnk" data-a="open" data-id="${s.surgery_id}">#${s.surgery_id}</button> ${esc(lab('procedure', s.procedure_id))} (${esc(lab('patient', s.patient_id))})</td><td>${s.surgery_date}</td><td>${t.length}</td><td>${t.map((x) => `${esc(x.task_name)} <span class="mu">[${x.status}]</span>`).join(', ') || '<span class="ok">All complete</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}

function vModal() {
  const m = st.modal; if (!m || !m.mode) return '';
  const u = me(), e = m.mode == 'edit' ? get('surgery', m.id) : {},
    pre = Object.assign({}, m.mode == 'new' ? { [u.key]: u.id } : {}, m.pre || {}, m.vals || {});
  const val = (k) => (m.mode == 'edit' ? (m.vals && k in m.vals ? m.vals[k] : e[k]) : pre[k]);
  return `<div class="ov" data-a="mclose" data-bg="1"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="cardhead"><h2 id="mt">${m.mode == 'edit' ? 'Edit surgery #' + m.id : 'Schedule a surgery'}</h2><button class="btn sm" data-a="mclose" aria-label="Close">Close</button></div>
${st.formErr ? `<div class="err" role="alert">${esc(st.formErr)}</div>` : ''}<form data-f="sf" class="grid" style="align-items:start">${Object.entries(S.surgery.f).map(([k, p]) => inp(k, p, val(k))).join('')}
<span class="inl" style="grid-column:1/-1"><button class="btn pri">${m.mode == 'edit' ? 'Save changes' : 'Check conflicts &amp; schedule'}</button><button type="button" class="btn" data-a="mclose">Cancel</button></span></form></div></div>`;
}

function render() {
  const u = me();
  $('#app').innerHTML = header(u) + (u ? `<main>${{ bookings: vB, map: vM, resources: vR, reports: vP }[st.tab]()}</main><footer><span>Connected to MySQL · surgical_scheduling</span><button class="lnk" data-a="reload">Reload data</button></footer>${vModal()}` : vAuth());
  if (u && st.tab == 'bookings' && st.view == 'list') list();
  const f = document.querySelector('.dlg input,.dlg select');
  if (f && st.modal && !st.modal.focused) { f.focus(); st.modal.focused = 1; }
}

/* ---- actions ---- */
async function act(el) {
  const d = el.dataset;
  try {
    switch (d.a) {
      case 'tab': nav('#/' + d.v); return;
      case 'open': nav('#/bookings/' + d.id); return;
      case 'back': nav('#/bookings'); return;
      case 'authtab': st.auth = d.v; st.authErr = ''; break;
      case 'surole': snapForm(); st.suRole = d.v; break;
      case 'demo': await signIn(d.email, 'demo1234'); nav('#/bookings'); return render();
      case 'signout': API.setToken(null); CURRENT = null; db = emptyDb(); st.modal = null; st.authErr = ''; await loadPublicDepartments(); break;
      case 'reload': await reload(); toast('Data reloaded from MySQL'); break;
      case 'new': st.modal = { mode: 'new' }; st.formErr = ''; break;
      case 'slot': st.modal = { mode: 'new', pre: { ot_id: +d.ot, surgery_date: st.mdate, start_time: d.t } }; st.formErr = ''; break;
      case 'sedit': st.modal = { mode: 'edit', id: +d.id }; st.formErr = ''; break;
      case 'mclose': if (d.bg && window.event.target !== el) return; st.modal = null; st.formErr = ''; break;
      case 'scope': st.scope = d.v; break;
      case 'cfscope': st.cfScope = d.v; break;
      case 'togglecf': st.showCf = !st.showCf; render(); if (st.showCf) $('#scan')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
      case 'seecf': st.showCf = true; st.cfScope = mine(get('surgery', +d.id)) ? 'mine' : 'all'; render(); $('#scan')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
      case 'clearf': st.q = st.fs = st.fd = ''; break;
      case 'sdel': st.cdel = +d.id; break;
      case 'sdelno': st.cdel = null; break;
      case 'sdelyes': {
        await API.del('/surgeries/' + d.id);
        st.cdel = null;
        await reload();
        toast('Surgery #' + d.id + ' deleted with its tasks and links');
        break;
      }
      case 'status': {
        await API.patch('/surgeries/' + st.sel + '/status', { status: d.v });
        await reload();
        toast('Status set to ' + d.v);
        break;
      }
      case 'tdel': await API.del('/tasks/' + d.id); await reload(); break;
      case 'pdel': await API.del(`/task-dependencies/${d.p}/${d.s}`); await reload(); break;
      case 'nrm': await API.del(`/surgeries/${st.sel}/nurses/${d.id}`); await reload(); break;
      case 'erm': await API.del(`/surgeries/${st.sel}/equipment/${d.id}`); await reload(); break;
      case 'sdrm': await API.del(`/surgery-dependencies/${d.p}/${d.s}`); await reload(); break;
      case 'rtab': st.res = d.v; st.redit = null; break;
      case 'redit': st.redit = +d.id; break;
      case 'rcancel': st.redit = null; break;
      case 'rdel': await API.del(`/resources/${st.res}/${d.id}`); await reload(); toast('Deleted'); break;
    }
  } catch (err) {
    toast(err.message, 1);
  }
  render();
}

async function sub(f) {
  const k = f.dataset.f;
  try {
    switch (k) {
      case 'li': {
        const e = f.email.value.trim().toLowerCase(), p = f.password.value;
        st.liEmail = e;
        if (!e || !p) { st.authErr = 'Enter your email and password.'; render(); return; }
        try {
          await signIn(e, p);
        } catch (err) {
          st.authErr = err.message; render(); return;
        }
        nav('#/bookings'); return render();
      }
      case 'su': {
        const v = {}; [...f.elements].forEach((x) => { if (x.name && !/password/.test(x.name)) v[x.name] = x.value.trim(); });
        st.sv = v;
        const isS = st.suRole == 'Surgeon', pw = f.password.value, pw2 = f.password2.value, errs = [];
        let name = v.name || '';
        if (name.length < 3) errs.push('Enter your full name.'); else if (!/^dr\.?\s/i.test(name)) name = 'Dr. ' + name;
        if (isS && !v.specialization) errs.push('Enter your specialization.');
        if (!/^[0-9]{10}$/.test(v.phone || '')) errs.push('Phone must be exactly 10 digits.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email || '')) errs.push('Enter a valid email address.');
        if (pw.length < 8) errs.push('Password must be at least 8 characters.'); else if (pw !== pw2) errs.push('The two passwords do not match.');
        if (errs.length) { st.authErr = errs.join(' '); render(); return; }
        try {
          const { token } = await API.register({
            role: st.suRole, name, specialization: v.specialization, phone: v.phone, dept_id: +v.dept_id, email: v.email, password: pw,
          });
          API.setToken(token);
          await reload();
          toast('Welcome, ' + name + '. Your account is ready.');
        } catch (err) {
          st.authErr = err.message; render(); return;
        }
        nav('#/bookings'); return render();
      }
      case 'sf': {
        const m = st.modal, v = fdata(f, S.surgery.f);
        m.vals = v;
        try {
          if (m.mode == 'edit') {
            await API.put('/surgeries/' + m.id, v);
            st.modal = null; st.formErr = '';
            await reload();
            toast('Surgery updated');
          } else {
            const { surgery } = await API.post('/surgeries', v);
            st.modal = null; st.formErr = '';
            await reload();
            toast('Surgery #' + surgery.surgery_id + ' scheduled with no conflicts. Add its pre-op tasks next.');
            nav('#/bookings/' + surgery.surgery_id); return render();
          }
        } catch (err) {
          st.formErr = err.message; render(); return;
        }
        break;
      }
      case 'tf': {
        await API.post('/tasks', { surgery_id: st.sel, task_name: f.task_name.value.trim(), task_type: f.task_type.value });
        await reload(); break;
      }
      case 'pf': {
        await API.post('/task-dependencies', {
          predecessor_task_id: +f.pred.value, successor_task_id: +f.dataset.id,
          dependency_type: f.type.value, lag_minutes: +f.lag.value || 0,
        });
        await reload(); break;
      }
      case 'nf': {
        await API.post(`/surgeries/${st.sel}/nurses`, { nurse_id: +f.nurse.value, role: f.role.value });
        await reload(); break;
      }
      case 'ef': {
        await API.post(`/surgeries/${st.sel}/equipment`, { equipment_id: +f.eq.value, quantity: +f.qty.value || 1 });
        await reload(); break;
      }
      case 'df': {
        await API.post('/surgery-dependencies', {
          predecessor_surgery_id: +f.pred.value, successor_surgery_id: st.sel, dependency_type: f.type.value,
        });
        await reload(); break;
      }
      case 'rf': {
        const t = st.res, v = fdata(f, S[t].f);
        if (st.redit) {
          await API.put(`/resources/${t}/${st.redit}`, v);
          st.redit = null;
          toast('Updated');
        } else {
          await API.post(`/resources/${t}`, v);
          toast('Added');
        }
        await reload(); break;
      }
    }
  } catch (err) {
    toast(err.message, 1);
  }
  render();
}

function snapForm() {
  const f = document.querySelector('form[data-f=su]'); if (!f) return;
  st.sv = {};
  [...f.elements].forEach((x) => { if (x.name && !/password/.test(x.name)) st.sv[x.name] = x.value; });
}

document.addEventListener('click', (e) => { const el = e.target.closest('[data-a]'); if (el) act(el); });
document.addEventListener('submit', (e) => { e.preventDefault(); sub(e.target); });
document.addEventListener('keydown', (e) => { if (e.key == 'Escape' && st.modal) { st.modal = null; st.formErr = ''; render(); } });
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.c != 'tstat') return;
  try {
    await API.patch('/tasks/' + el.dataset.id + '/status', { status: el.value });
    await reload();
  } catch (err) {
    toast(err.message, 1);
  }
  render();
});
document.addEventListener('input', (e) => {
  const k = e.target.dataset.k; if (!k) return;
  st[k] = e.target.value;
  k == 'rdate' || k == 'mdate' ? render() : list();
});

/* ---- boot ---- */
async function boot() {
  parse();
  if (API.hasToken()) {
    try { await reload(); parse(); }
    catch (err) {
      if (err.status === 401) { API.setToken(null); CURRENT = null; }
      else toast(err.message, 1);
    }
  }
  if (!CURRENT) await loadPublicDepartments();
  render();
}
boot();
