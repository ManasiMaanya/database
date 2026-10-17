# Surgical Scheduling and Dependency Management System

A hospital surgery planner built on the database designed in **Review 1** (ER model) and
**Review 2** (MySQL schema). This repository adds the missing piece: an **Express + MySQL
backend** and a **single-page frontend** that reads and writes the real database.

The database is the source of truth. Scheduling rules — no double-booked surgeons,
theatres, beds, nurses or equipment; no skipped pre-operative steps; no circular
dependencies; a surgery cannot be marked *Ready* while anything blocks it — are enforced
by **MySQL triggers and views**, not by JavaScript. The API is a thin layer over them, so
a bug in the UI cannot corrupt the schedule.

---

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Demo logins](#demo-logins)
- [Running the smoke test](#running-the-smoke-test)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [How the rules are enforced](#how-the-rules-are-enforced)
- [Security notes](#security-notes)

---

## Architecture

```
Browser (public/)
   │  fetch + JWT
   ▼
Express API (server/)
   │  mysql2 connection pool
   ▼
MySQL 8  ──  surgical_scheduling
              15 tables · 17 foreign keys · 17 CHECK rules
              9 views · 1 stored procedure · 11 triggers
```

- The frontend keeps a live in-memory mirror of the data, refreshed from
  `GET /api/bootstrap` after every write. Conflict and blocker information in the UI comes
  from the SQL views `v_conflicts` and `v_surgery_blockers`.
- The API never re-implements a business rule. When the database rejects a write, the
  trigger's message is passed straight back to the browser as HTTP `409`.

---

## Prerequisites

- **Node.js 18+** (developed on Node 24)
- **MySQL 8.0.16+** running locally (developed on 8.0.46)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the connection

Copy the example file and fill in your MySQL details:

```bash
copy .env.example .env      # Windows
cp .env.example .env        # macOS / Linux
```

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=surgical_scheduling
PORT=3000
JWT_SECRET=some-long-random-string
```

### 3. Create and load the database

```bash
npm run db:load
```

This runs, in order:

| File | What it does |
|---|---|
| `sql/01_surgical_scheduling.sql` | Review 2 schema: 15 tables, 128 sample rows, 9 views, 1 procedure, 11 triggers. **Starts with `DROP DATABASE surgical_scheduling`.** |
| `sql/02_auth.sql` | Adds `Doctor_Account` and 10 demo logins (the one table the frontend needs that Review 2 did not include). |

> If `02_auth.sql` is ever out of date, regenerate it with `npm run db:auth`
> (it hashes the demo password exactly as the original prototype did).

You can also load the files by hand in Workbench or the `mysql` client — they are
ordinary MySQL scripts.

### 4. Start the server

```bash
npm start        # or: npm run dev   (auto-restart on change)
```

Then open **http://localhost:3000**.

---

## Demo logins

Every seeded doctor has an account with the password **`demo1234`**:

| Email | Role | Notes |
|---|---|---|
| `anita.desai@hospital.test` | Surgeon | Has 2 conflicting surgeries (#3 and #7) |
| `rohan.iyer@hospital.test` | Surgeon | Has 1 conflict |
| `kavita.menon@hospital.test` | Anesthetist | |

The sign-in screen has one-click buttons for these. New accounts can be created from the
**Sign up** tab.

---

## Running the smoke test

With the server running:

```bash
npm run test        # 45 end-to-end checks
```

It signs in, verifies the read endpoints against the sample data, exercises the write
paths, and confirms that the database triggers reject every rule violation. Anything it
creates is deleted again.

---

## API reference

All routes are prefixed with `/api`. Every route except `auth` and `health` requires a
`Authorization: Bearer <token>` header.

### Auth

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness + MySQL version |
| `POST` | `/api/auth/register` | Create a doctor (Surgeon/Anesthetist) and its login |
| `POST` | `/api/auth/login` | Sign in, returns a JWT |
| `GET` | `/api/auth/me` | Current doctor |
| `GET` | `/api/auth/departments` | Public: departments for the sign-up form |
| `GET` | `/api/auth/demo-accounts` | Public: seeded logins |

### Data & scheduling

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/bootstrap` | The whole dataset + conflict/blocker maps + current user |
| `GET` | `/api/surgeries` · `POST` | List / create |
| `GET` | `/api/surgeries/:id` | Detail: tasks, team, equipment, links, conflicts, blockers |
| `PUT` | `/api/surgeries/:id` | Edit |
| `PATCH` | `/api/surgeries/:id/status` | Change status (guarded by trigger) |
| `DELETE` | `/api/surgeries/:id` | Delete (cascades to tasks and links) |
| `POST` | `/api/tasks` | Add a pre-operative task |
| `PATCH` | `/api/tasks/:id/status` | Change task status (guarded by trigger) |
| `DELETE` | `/api/tasks/:id` | Delete a task |
| `POST` | `/api/task-dependencies` | Link two tasks (cycle-checked) |
| `DELETE` | `/api/task-dependencies/:pred/:succ` | Remove a task link |
| `POST` | `/api/surgery-dependencies` | Link staged surgeries (cycle- and date-checked) |
| `DELETE` | `/api/surgery-dependencies/:pred/:succ` | Remove a surgery link |
| `POST` | `/api/surgeries/:id/nurses` · `DELETE .../:nurseId` | Assign / remove a nurse |
| `POST` | `/api/surgeries/:id/equipment` · `DELETE .../:equipmentId` | Assign / remove equipment |

### Reference data

`GET`, `POST`, `PUT`, `DELETE` on `/api/resources/:type`, where `:type` is one of
`dept`, `surgeon`, `anesthetist`, `patient`, `procedure`, `ot`, `bed`, `nurse`, `equipment`.
Deletes that violate a foreign key return `409`.

### Reports (the SQL views and procedure)

| Method | Path | Backed by |
|---|---|---|
| `GET` | `/api/reports/schedule` | `v_surgery_schedule` |
| `GET` | `/api/reports/readiness` | `v_surgery_readiness_full` |
| `GET` | `/api/reports/conflicts` | `v_conflicts` |
| `GET` | `/api/reports/pending-tasks` | `v_pending_tasks` |
| `GET` | `/api/reports/status-counts` | `v_status_counts` |
| `GET` | `/api/reports/task-chain?surgery_id=` | `v_task_chain` (recursive CTE) |
| `GET` | `/api/reports/surgeon-workload` | Q2 (GROUP BY / HAVING) |
| `GET` | `/api/reports/theatre-utilization?date=` | `sp_theatre_utilization` |

---

## Project structure

```
db/
├── package.json
├── .env.example
├── sql/
│   ├── 01_surgical_scheduling.sql   # Review 2 schema, data, views, triggers
│   └── 02_auth.sql                  # Doctor_Account + demo logins
├── scripts/
│   ├── load-sql.js                  # loads ./sql into MySQL (honours DELIMITER)
│   ├── gen-auth-sql.js              # regenerates 02_auth.sql
│   └── smoke-test.js                # 45 end-to-end API checks
├── server/
│   ├── index.js                     # app wiring, static hosting, error handling
│   ├── config.js  db.js  schema.js
│   ├── middleware/  auth.js  errors.js
│   ├── routes/      auth.js  bootstrap.js  resources.js  surgeries.js
│   │                tasks.js  dependencies.js  assignments.js  reports.js
│   └── services/    passwords.js  validate.js  snapshot.js  access.js
└── public/
    ├── index.html                   # the Review 3 layout (unchanged styling)
    ├── app.js                       # UI + flows, now API-driven
    └── api.js                       # fetch wrapper + JWT handling
```

---

## How the rules are enforced

Rules that span more than one row live in the database, so they hold no matter who or
what writes to it:

| Rule | Enforced by |
|---|---|
| No overlapping surgeon / anesthetist / theatre / bed | `trg_surgery_bi`, `trg_surgery_bu` → `sp_check_surgery_conflicts` |
| A theatre under maintenance cannot be booked | same trigger |
| A nurse / equipment item cannot be in two overlapping surgeries | `trg_nurse_*`, `trg_equipment_*` |
| A task cannot start or finish before its predecessors | `trg_task_status_bu` |
| No cycles, no self-links, no cross-surgery task links | `sp_check_task_dependency`, `sp_check_surgery_dependency` |
| *Ready* / *Completed* only when nothing blocks the surgery | `trg_surgery_bu` + `v_surgery_blockers` |

The API surfaces these as `409 Conflict` with the trigger's own message, e.g.
`Surgeon is already booked in overlapping surgery 3`.

---

## Security notes

This is a course project, and a few choices favour fidelity to the original prototype
over production hardening:

- **Password hashing** is `sha256(salt || password)` — chosen so the seeded demo logins
  and the original browser prototype match. It is fast and therefore weak against offline
  guessing. A real deployment should use `bcrypt` or `argon2`.
- **`JWT_SECRET`** must be set in `.env`; the server warns loudly if it is not.
- Enable HTTPS and set a short token lifetime before exposing the API beyond localhost.
