-- =====================================================================
-- Surgical Scheduling and Dependency Management System
-- COMPLETE BACKEND DATABASE  |  MySQL 8.0.16 or later (tested on 8.0.46)
--
--   Section 1  Tables (15 relational tables)
--   Section 2  Sample data
--   Section 3  Queries and base views
--   Section 4  Integrity constraints in action (commented demos)
--   Section 5  Frontend support: views, procedures, triggers
--   Section 6  Rule demonstrations (commented, with expected results)
--
-- Run the whole file in the mysql client (it uses DELIMITER) or in
-- MySQL Workbench. Triggers are created at the END of Section 5 so the
-- sample data, which contains deliberate overlaps, loads without errors.
--
-- MySQL differences from the PostgreSQL version:
--   * "Procedure" is a reserved word in MySQL, so the table is Surgical_Procedure.
--   * Foreign keys are declared with FOREIGN KEY clauses (inline REFERENCES is ignored by MySQL).
--   * MySQL forbids CHECK constraints on columns that have ON DELETE CASCADE foreign keys,
--     so "a task cannot depend on itself" is enforced by a trigger procedure instead.
--   * MySQL has no partial indexes and no WHEN clause on triggers; the overlap trigger
--     replaces the three UNIQUE slot constraints (and ignores cancelled surgeries).
--   * MySQL has no table-returning functions, so the utilization report is a stored procedure.
-- =====================================================================

DROP DATABASE IF EXISTS surgical_scheduling;
CREATE DATABASE surgical_scheduling CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE surgical_scheduling;

-- =====================================================================
-- Section 1: Table creation
-- =====================================================================

-- ---------- Core entities ----------
CREATE TABLE Department (
    dept_id    INT          AUTO_INCREMENT PRIMARY KEY,
    dept_name  VARCHAR(60)  NOT NULL UNIQUE,
    location   VARCHAR(60)  NOT NULL
);

CREATE TABLE Surgeon (
    surgeon_id      INT          AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(80)  NOT NULL,
    specialization  VARCHAR(60)  NOT NULL,
    phone           VARCHAR(15)  UNIQUE,
    dept_id         INT          NOT NULL,
    FOREIGN KEY (dept_id) REFERENCES Department(dept_id)
);

CREATE TABLE Anesthetist (
    anesthetist_id  INT          AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(80)  NOT NULL,
    phone           VARCHAR(15)  UNIQUE,
    dept_id         INT          NOT NULL,
    FOREIGN KEY (dept_id) REFERENCES Department(dept_id)
);

CREATE TABLE Patient (
    patient_id   INT          AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(80)  NOT NULL,
    dob          DATE         NOT NULL CHECK (dob >= '1900-01-01'),
    blood_group  VARCHAR(3)   CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-'))
);

CREATE TABLE Surgical_Procedure (
    procedure_id     INT          AUTO_INCREMENT PRIMARY KEY,
    procedure_name   VARCHAR(80)  NOT NULL UNIQUE,
    est_duration_min INT          NOT NULL CHECK (est_duration_min > 0),
    risk_level       VARCHAR(10)  NOT NULL CHECK (risk_level IN ('Low','Medium','High'))
);

CREATE TABLE Operating_Theatre (
    ot_id    INT          AUTO_INCREMENT PRIMARY KEY,
    ot_name  VARCHAR(30)  NOT NULL UNIQUE,
    ot_type  VARCHAR(40)  NOT NULL,
    status   VARCHAR(15)  NOT NULL DEFAULT 'Available'
             CHECK (status IN ('Available','In use','Maintenance'))
);

CREATE TABLE Recovery_Bed (
    bed_id  INT          AUTO_INCREMENT PRIMARY KEY,
    ward    VARCHAR(40)  NOT NULL,
    status  VARCHAR(15)  NOT NULL DEFAULT 'Available'
            CHECK (status IN ('Available','Occupied','Cleaning'))
);

CREATE TABLE Nurse (
    nurse_id  INT          AUTO_INCREMENT PRIMARY KEY,
    name      VARCHAR(80)  NOT NULL,
    shift     VARCHAR(10)  NOT NULL CHECK (shift IN ('Morning','Evening','Night'))
);

CREATE TABLE Equipment (
    equipment_id    INT          AUTO_INCREMENT PRIMARY KEY,
    equipment_name  VARCHAR(80)  NOT NULL,
    category        VARCHAR(40)  NOT NULL,
    sterile_status  VARCHAR(15)  NOT NULL DEFAULT 'Not sterile'
                    CHECK (sterile_status IN ('Sterile','Not sterile'))
);

-- ---------- Central entity ----------
CREATE TABLE Surgery (
    surgery_id      INT          AUTO_INCREMENT PRIMARY KEY,
    surgery_date    DATE         NOT NULL,
    start_time      TIME         NOT NULL,
    priority        VARCHAR(10)  NOT NULL DEFAULT 'Routine'
                    CHECK (priority IN ('Routine','Urgent','Emergency')),
    status          VARCHAR(10)  NOT NULL DEFAULT 'Scheduled'
                    CHECK (status IN ('Scheduled','Ready','Completed','Cancelled')),
    patient_id      INT NOT NULL,
    procedure_id    INT NOT NULL,
    surgeon_id      INT NOT NULL,
    anesthetist_id  INT NOT NULL,
    ot_id           INT NOT NULL,
    bed_id          INT NOT NULL,
    FOREIGN KEY (patient_id)     REFERENCES Patient(patient_id),
    FOREIGN KEY (procedure_id)   REFERENCES Surgical_Procedure(procedure_id),
    FOREIGN KEY (surgeon_id)     REFERENCES Surgeon(surgeon_id),
    FOREIGN KEY (anesthetist_id) REFERENCES Anesthetist(anesthetist_id),
    FOREIGN KEY (ot_id)          REFERENCES Operating_Theatre(ot_id),
    FOREIGN KEY (bed_id)         REFERENCES Recovery_Bed(bed_id),
    INDEX idx_surgery_slot (surgery_date, start_time)
);

CREATE TABLE Pre_Op_Task (
    task_id     INT          AUTO_INCREMENT PRIMARY KEY,
    task_name   VARCHAR(80)  NOT NULL,
    task_type   VARCHAR(15)  NOT NULL
                CHECK (task_type IN ('Test','Clearance','Consent','Preparation')),
    status      VARCHAR(15)  NOT NULL DEFAULT 'Pending'
                CHECK (status IN ('Pending','In progress','Completed')),
    surgery_id  INT          NOT NULL,
    FOREIGN KEY (surgery_id) REFERENCES Surgery(surgery_id) ON DELETE CASCADE
);

-- ---------- Link tables (many-to-many relationships) ----------
CREATE TABLE Surgery_Nurse (
    surgery_id  INT          NOT NULL,
    nurse_id    INT          NOT NULL,
    role        VARCHAR(20)  NOT NULL
                CHECK (role IN ('Scrub nurse','Circulating nurse','Recovery nurse')),
    PRIMARY KEY (surgery_id, nurse_id),
    FOREIGN KEY (surgery_id) REFERENCES Surgery(surgery_id) ON DELETE CASCADE,
    FOREIGN KEY (nurse_id)   REFERENCES Nurse(nurse_id)
);

CREATE TABLE Surgery_Equipment (
    surgery_id    INT  NOT NULL,
    equipment_id  INT  NOT NULL,
    quantity      INT  NOT NULL DEFAULT 1 CHECK (quantity > 0),
    PRIMARY KEY (surgery_id, equipment_id),
    FOREIGN KEY (surgery_id)   REFERENCES Surgery(surgery_id) ON DELETE CASCADE,
    FOREIGN KEY (equipment_id) REFERENCES Equipment(equipment_id)
);

-- No CHECK (predecessor <> successor) here: MySQL forbids CHECK on cascade-FK columns.
-- That rule, plus cycle detection, lives in sp_check_task_dependency (Section 5).
CREATE TABLE Task_Dependency (
    predecessor_task_id  INT          NOT NULL,
    successor_task_id    INT          NOT NULL,
    dependency_type      VARCHAR(20)  NOT NULL DEFAULT 'Finish-to-start'
                         CHECK (dependency_type IN ('Finish-to-start','Start-to-start')),
    lag_minutes          INT          NOT NULL DEFAULT 0 CHECK (lag_minutes >= 0),
    PRIMARY KEY (predecessor_task_id, successor_task_id),
    FOREIGN KEY (predecessor_task_id) REFERENCES Pre_Op_Task(task_id) ON DELETE CASCADE,
    FOREIGN KEY (successor_task_id)   REFERENCES Pre_Op_Task(task_id) ON DELETE CASCADE
);

CREATE TABLE Surgery_Dependency (
    predecessor_surgery_id  INT          NOT NULL,
    successor_surgery_id    INT          NOT NULL,
    dependency_type         VARCHAR(20)  NOT NULL DEFAULT 'Finish-to-start'
                            CHECK (dependency_type IN ('Finish-to-start','Start-to-start')),
    PRIMARY KEY (predecessor_surgery_id, successor_surgery_id),
    FOREIGN KEY (predecessor_surgery_id) REFERENCES Surgery(surgery_id) ON DELETE CASCADE,
    FOREIGN KEY (successor_surgery_id)   REFERENCES Surgery(surgery_id) ON DELETE CASCADE
);

-- =====================================================================
-- Section 2: Sample data (parents first, children after)
-- =====================================================================

INSERT INTO Department VALUES
 (1,'Cardiology','Block A, Floor 3'),
 (2,'Orthopedics','Block B, Floor 2'),
 (3,'General Surgery','Block A, Floor 1'),
 (4,'Neurology','Block C, Floor 4'),
 (5,'Obstetrics and Gynecology','Block B, Floor 1');

INSERT INTO Surgeon VALUES
 (1,'Dr. Rohan Iyer','Cardiac surgery','9840010001',1),
 (2,'Dr. Meera Krishnan','Cardiac surgery','9840010002',1),
 (3,'Dr. Sandeep Verma','Joint replacement','9840010003',2),
 (4,'Dr. Anita Desai','Laparoscopic surgery','9840010004',3),
 (5,'Dr. Farhan Qureshi','Neurosurgery','9840010005',4),
 (6,'Dr. Lakshmi Rao','Gynecologic surgery','9840010006',5);

INSERT INTO Anesthetist VALUES
 (1,'Dr. Kavita Menon','9840020001',1),
 (2,'Dr. Arvind Pillai','9840020002',3),
 (3,'Dr. Neha Bansal','9840020003',2),
 (4,'Dr. Imran Sheikh','9840020004',4);

INSERT INTO Patient VALUES
 (1,'Arjun Mehta','1962-03-14','B+'),
 (2,'Priya Nair','1988-07-22','O+'),
 (3,'Rajesh Kumar','1955-11-02','A+'),
 (4,'Sneha Reddy','1994-01-30','AB+'),
 (5,'Mohammed Faizal','1971-09-18','O-'),
 (6,'Divya Sharma','1983-05-09','A-'),
 (7,'Karthik Subramanian','1949-12-25','B-'),
 (8,'Ananya Das','1999-08-16','O+'),
 (9,'Vikram Singh','1967-04-04','AB-'),
 (10,'Lata Joshi','1976-10-11','A+');

INSERT INTO Surgical_Procedure VALUES
 (1,'Coronary artery bypass',240,'High'),
 (2,'Knee replacement',150,'Medium'),
 (3,'Laparoscopic cholecystectomy',90,'Low'),
 (4,'Craniotomy',300,'High'),
 (5,'Hip replacement',180,'Medium'),
 (6,'Hysterectomy',120,'Medium'),
 (7,'Appendectomy',60,'Low'),
 (8,'Sternal reconstruction',150,'Medium');

INSERT INTO Operating_Theatre VALUES
 (1,'OT-1','Cardiac','Available'),
 (2,'OT-2','Orthopedic','Available'),
 (3,'OT-3','General','Available'),
 (4,'OT-4','Neurosurgical','Available'),
 (5,'OT-5','General','Maintenance');

INSERT INTO Recovery_Bed VALUES
 (1,'Cardiac ICU','Available'),
 (2,'Cardiac ICU','Available'),
 (3,'Ortho Ward','Available'),
 (4,'General Ward','Available'),
 (5,'General Ward','Occupied'),
 (6,'Neuro ICU','Available');

INSERT INTO Nurse VALUES
 (1,'Sunita Pandey','Morning'),
 (2,'Joseph Thomas','Morning'),
 (3,'Rekha Menon','Morning'),
 (4,'Pooja Gupta','Evening'),
 (5,'Anil Nambiar','Morning'),
 (6,'Fatima Khan','Evening'),
 (7,'Deepa Iyer','Night'),
 (8,'Suresh Babu','Morning');

INSERT INTO Equipment VALUES
 (1,'Cardiac surgery instrument set','Instrument set','Sterile'),
 (2,'Heart-lung machine','Machine','Sterile'),
 (3,'Orthopedic power saw','Power tool','Sterile'),
 (4,'Laparoscopy tower','Imaging','Sterile'),
 (5,'Surgical drill set','Power tool','Not sterile'),
 (6,'Anesthesia workstation','Machine','Sterile'),
 (7,'Electrocautery unit','Machine','Sterile'),
 (8,'Sternal retractor','Instrument set','Not sterile');

-- Surgeries 3 and 7 deliberately overlap for the same surgeon, anesthetist, theatre and bed.
-- Nurse Joseph Thomas (surgeries 1 and 3) and nurse Deepa Iyer (surgeries 1 and 7) also overlap.
INSERT INTO Surgery VALUES
 (1,'2026-10-14','08:00','Urgent',   'Scheduled',1,1,1,1,1,1),
 (2,'2026-10-16','09:00','Routine',  'Scheduled',2,2,3,3,2,3),
 (3,'2026-10-14','09:00','Routine',  'Scheduled',3,3,4,2,3,4),
 (4,'2026-10-15','07:30','Emergency','Ready',    4,7,4,2,3,5),
 (5,'2026-10-17','10:00','Routine',  'Scheduled',5,4,5,4,4,6),
 (6,'2026-10-22','08:30','Routine',  'Scheduled',1,8,1,1,1,2),
 (7,'2026-10-14','10:00','Routine',  'Scheduled',6,3,4,2,3,4),
 (8,'2026-10-18','11:00','Routine',  'Scheduled',7,5,3,3,2,3),
 (9,'2026-10-19','09:00','Urgent',   'Cancelled',9,1,2,1,1,1),
 (10,'2026-10-20','14:00','Routine', 'Completed',10,3,4,2,3,4);

INSERT INTO Pre_Op_Task VALUES
 ( 1,'Blood tests and ECG','Test','Completed',1),
 ( 2,'Cardiology clearance','Clearance','Completed',1),
 ( 3,'Anesthesia clearance','Clearance','In progress',1),
 ( 4,'Consent form signed','Consent','Pending',1),
 ( 5,'Blood work','Test','Completed',2),
 ( 6,'Orthopedic clearance','Clearance','In progress',2),
 ( 7,'Consent form signed','Consent','Pending',2),
 ( 8,'Ultrasound','Test','Completed',3),
 ( 9,'Consent form signed','Consent','Completed',3),
 (10,'Blood work','Test','Completed',4),
 (11,'Consent form signed','Consent','Completed',4),
 (12,'MRI scan','Test','Completed',5),
 (13,'Neurology clearance','Clearance','Pending',5),
 (14,'Consent form signed','Consent','Pending',5),
 (15,'Wound healing review','Clearance','Pending',6),
 (16,'Consent form signed','Consent','Pending',6),
 (17,'Blood work','Test','Completed',7),
 (18,'Consent form signed','Consent','Completed',7),
 (19,'Blood work','Test','Completed',8),
 (20,'Consent form signed','Consent','Completed',8);

INSERT INTO Surgery_Nurse VALUES
 (1,1,'Scrub nurse'),(1,2,'Circulating nurse'),(1,7,'Recovery nurse'),
 (2,3,'Scrub nurse'),(2,8,'Circulating nurse'),
 (3,5,'Scrub nurse'),(3,2,'Circulating nurse'),
 (4,5,'Scrub nurse'),(4,4,'Circulating nurse'),
 (5,1,'Scrub nurse'),(5,6,'Recovery nurse'),
 (7,3,'Scrub nurse'),(7,7,'Recovery nurse'),
 (8,8,'Scrub nurse');

INSERT INTO Surgery_Equipment VALUES
 (1,1,1),(1,2,1),(1,6,1),(1,8,1),
 (2,3,1),(2,6,1),(2,7,1),
 (3,4,1),(3,7,1),
 (4,4,1),(4,7,1),
 (5,5,2),(5,6,1),
 (6,1,1),(6,8,1);

INSERT INTO Task_Dependency VALUES
 (1,2,'Finish-to-start',0),
 (2,3,'Finish-to-start',0),
 (3,4,'Finish-to-start',0),
 (5,6,'Finish-to-start',0),
 (6,7,'Finish-to-start',30),
 (12,13,'Finish-to-start',0),
 (13,14,'Finish-to-start',0),
 (15,16,'Finish-to-start',0);

INSERT INTO Surgery_Dependency VALUES
 (1,6,'Finish-to-start');

-- =====================================================================
-- Section 3: SQL queries and base views
-- =====================================================================

-- Q1. SELECT + WHERE + ORDER BY: urgent and emergency surgeries still on the books
SELECT surgery_id, surgery_date, start_time, priority, status
FROM   Surgery
WHERE  priority IN ('Urgent','Emergency')
  AND  status <> 'Cancelled'
ORDER  BY surgery_date, start_time;

-- Q2. GROUP BY + HAVING + aggregates: workload per surgeon (2 or more surgeries)
SELECT sg.name                          AS surgeon,
       COUNT(*)                         AS surgeries,
       SUM(p.est_duration_min)          AS total_minutes,
       ROUND(AVG(p.est_duration_min))   AS avg_minutes,
       MAX(p.est_duration_min)          AS longest
FROM   Surgery s
JOIN   Surgeon sg           ON sg.surgeon_id  = s.surgeon_id
JOIN   Surgical_Procedure p ON p.procedure_id = s.procedure_id
WHERE  s.status <> 'Cancelled'
GROUP  BY sg.name
HAVING COUNT(*) >= 2
ORDER  BY total_minutes DESC, surgeon;

-- Q3. JOIN: the daily schedule with real names instead of IDs
SELECT s.surgery_id, s.surgery_date, s.start_time,
       pt.name AS patient, pr.procedure_name, sg.name AS surgeon, ot.ot_name
FROM   Surgery s
JOIN   Patient            pt ON pt.patient_id   = s.patient_id
JOIN   Surgical_Procedure pr ON pr.procedure_id = s.procedure_id
JOIN   Surgeon            sg ON sg.surgeon_id   = s.surgeon_id
JOIN   Operating_Theatre  ot ON ot.ot_id        = s.ot_id
WHERE  s.status <> 'Cancelled'
ORDER  BY s.surgery_date, s.start_time;

-- Q4a. Subquery (IN): surgeries that still have unfinished pre-op tasks
SELECT surgery_id, surgery_date, status
FROM   Surgery
WHERE  surgery_id IN (SELECT surgery_id FROM Pre_Op_Task WHERE status <> 'Completed')
ORDER  BY surgery_id;

-- Q4b. Subquery (scalar): procedures longer than the average
SELECT procedure_name, est_duration_min
FROM   Surgical_Procedure
WHERE  est_duration_min > (SELECT AVG(est_duration_min) FROM Surgical_Procedure)
ORDER  BY est_duration_min DESC;

-- Q4c. Correlated subquery (EXISTS): tasks blocked by an unfinished predecessor
SELECT t.task_id, t.task_name, t.surgery_id
FROM   Pre_Op_Task t
WHERE  t.status <> 'Completed'
  AND  EXISTS (SELECT 1
               FROM   Task_Dependency d
               JOIN   Pre_Op_Task p ON p.task_id = d.predecessor_task_id
               WHERE  d.successor_task_id = t.task_id
                 AND  p.status <> 'Completed')
ORDER  BY t.surgery_id, t.task_id;

-- Q5. Conflict detection: same surgeon, same day, overlapping time windows
SELECT a.surgery_id AS surgery_a, b.surgery_id AS surgery_b,
       sg.name AS surgeon, a.surgery_date
FROM   Surgery a
JOIN   Surgery b ON  a.surgeon_id   = b.surgeon_id
                 AND a.surgery_date = b.surgery_date
                 AND a.surgery_id   < b.surgery_id
JOIN   Surgical_Procedure pa ON pa.procedure_id = a.procedure_id
JOIN   Surgical_Procedure pb ON pb.procedure_id = b.procedure_id
JOIN   Surgeon sg ON sg.surgeon_id = a.surgeon_id
WHERE  a.status <> 'Cancelled' AND b.status <> 'Cancelled'
  AND  TIMESTAMP(a.surgery_date, a.start_time)
         < DATE_ADD(TIMESTAMP(b.surgery_date, b.start_time), INTERVAL pb.est_duration_min MINUTE)
  AND  TIMESTAMP(b.surgery_date, b.start_time)
         < DATE_ADD(TIMESTAMP(a.surgery_date, a.start_time), INTERVAL pa.est_duration_min MINUTE);

-- Q6. Views
-- Schedule view: includes end time, duration and IDs for the Surgeries list and Theatre map
CREATE OR REPLACE VIEW v_surgery_schedule AS
SELECT s.surgery_id, s.surgery_date, s.start_time,
       ADDTIME(s.start_time, SEC_TO_TIME(pr.est_duration_min * 60)) AS end_time,
       pr.est_duration_min AS duration_min,
       s.priority, s.status,
       pt.name AS patient, pr.procedure_name, sg.name AS surgeon,
       an.name AS anesthetist, ot.ot_name, s.ot_id, s.surgeon_id, s.bed_id
FROM   Surgery s
JOIN   Patient            pt ON pt.patient_id     = s.patient_id
JOIN   Surgical_Procedure pr ON pr.procedure_id   = s.procedure_id
JOIN   Surgeon            sg ON sg.surgeon_id     = s.surgeon_id
JOIN   Anesthetist        an ON an.anesthetist_id = s.anesthetist_id
JOIN   Operating_Theatre  ot ON ot.ot_id          = s.ot_id;

-- Simple readiness view (tasks only); see v_surgery_readiness_full in Section 5 for the full check
CREATE OR REPLACE VIEW v_surgery_readiness AS
SELECT s.surgery_id, pt.name AS patient, pr.procedure_name,
       COUNT(t.task_id)                                       AS total_tasks,
       COUNT(CASE WHEN t.status = 'Completed' THEN 1 END)     AS done_tasks,
       CASE WHEN COUNT(t.task_id) = COUNT(CASE WHEN t.status = 'Completed' THEN 1 END)
            THEN 'Ready' ELSE 'Blocked' END                   AS readiness
FROM   Surgery s
JOIN   Patient            pt ON pt.patient_id   = s.patient_id
JOIN   Surgical_Procedure pr ON pr.procedure_id = s.procedure_id
LEFT   JOIN Pre_Op_Task t ON t.surgery_id = s.surgery_id
WHERE  s.status IN ('Scheduled','Ready')
GROUP  BY s.surgery_id, pt.name, pr.procedure_name;

SELECT * FROM v_surgery_readiness ORDER BY surgery_id;

-- =====================================================================
-- Section 4: Integrity constraints in action (each statement should FAIL)
-- Uncomment one at a time. 4d and 4e are enforced by the Section 5 triggers.
-- =====================================================================
-- 4a. Foreign key: surgery for a patient that does not exist
-- INSERT INTO Surgery VALUES (11,'2026-10-25','09:00','Routine','Scheduled',99,1,1,1,1,1);
-- 4b. CHECK: invalid status value
-- INSERT INTO Pre_Op_Task VALUES (21,'Chest X-ray','Test','Done',1);
-- 4c. Primary key: duplicate patient_id
-- INSERT INTO Patient VALUES (1,'Duplicate Person','1990-01-01','O+');
-- 4d. Double booking: theatre OT-3 is already in use at 09:00 on 14 Oct
-- INSERT INTO Surgery VALUES (11,'2026-10-14','09:00','Routine','Scheduled',8,7,4,2,3,4);
-- 4e. A task cannot depend on itself
-- INSERT INTO Task_Dependency VALUES (3,3,'Finish-to-start',0);
-- 4f. Referential integrity: cannot delete a patient who has surgeries
-- DELETE FROM Patient WHERE patient_id = 1;

-- =====================================================================
-- Section 5: Frontend support (views, procedures, triggers)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 5.1 Conflict detection views: overlapping time windows, ALL resources
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_overlapping_pairs AS
SELECT a.surgery_id AS a_id, b.surgery_id AS b_id
FROM   Surgery a
JOIN   Surgical_Procedure pa ON pa.procedure_id = a.procedure_id
JOIN   Surgery b             ON b.surgery_id > a.surgery_id AND b.surgery_date = a.surgery_date
JOIN   Surgical_Procedure pb ON pb.procedure_id = b.procedure_id
WHERE  a.status <> 'Cancelled' AND b.status <> 'Cancelled'
  AND  TIMESTAMP(a.surgery_date, a.start_time)
         < DATE_ADD(TIMESTAMP(b.surgery_date, b.start_time), INTERVAL pb.est_duration_min MINUTE)
  AND  TIMESTAMP(b.surgery_date, b.start_time)
         < DATE_ADD(TIMESTAMP(a.surgery_date, a.start_time), INTERVAL pa.est_duration_min MINUTE);

CREATE OR REPLACE VIEW v_conflicts AS
SELECT o.a_id, o.b_id, 'Surgeon' AS resource, r.name AS resource_name
FROM v_overlapping_pairs o JOIN Surgery a ON a.surgery_id = o.a_id JOIN Surgery b ON b.surgery_id = o.b_id
JOIN Surgeon r ON r.surgeon_id = a.surgeon_id WHERE a.surgeon_id = b.surgeon_id
UNION ALL
SELECT o.a_id, o.b_id, 'Anesthetist', r.name
FROM v_overlapping_pairs o JOIN Surgery a ON a.surgery_id = o.a_id JOIN Surgery b ON b.surgery_id = o.b_id
JOIN Anesthetist r ON r.anesthetist_id = a.anesthetist_id WHERE a.anesthetist_id = b.anesthetist_id
UNION ALL
SELECT o.a_id, o.b_id, 'Theatre', r.ot_name
FROM v_overlapping_pairs o JOIN Surgery a ON a.surgery_id = o.a_id JOIN Surgery b ON b.surgery_id = o.b_id
JOIN Operating_Theatre r ON r.ot_id = a.ot_id WHERE a.ot_id = b.ot_id
UNION ALL
SELECT o.a_id, o.b_id, 'Recovery bed', CONCAT('Bed ', a.bed_id)
FROM v_overlapping_pairs o JOIN Surgery a ON a.surgery_id = o.a_id JOIN Surgery b ON b.surgery_id = o.b_id
WHERE a.bed_id = b.bed_id
UNION ALL
SELECT o.a_id, o.b_id, 'Nurse', n.name
FROM v_overlapping_pairs o
JOIN Surgery_Nurse x ON x.surgery_id = o.a_id
JOIN Surgery_Nurse y ON y.surgery_id = o.b_id AND y.nurse_id = x.nurse_id
JOIN Nurse n ON n.nurse_id = x.nurse_id
UNION ALL
SELECT o.a_id, o.b_id, 'Equipment', e.equipment_name
FROM v_overlapping_pairs o
JOIN Surgery_Equipment x ON x.surgery_id = o.a_id
JOIN Surgery_Equipment y ON y.surgery_id = o.b_id AND y.equipment_id = x.equipment_id
JOIN Equipment e ON e.equipment_id = x.equipment_id;

-- ---------------------------------------------------------------------
-- 5.2 Readiness: everything that blocks a surgery from Ready / Completed
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_surgery_blockers AS
SELECT t.surgery_id, CONCAT('Task not completed: ', t.task_name, ' (', t.status, ')') AS reason
FROM   Pre_Op_Task t WHERE t.status <> 'Completed'
UNION ALL
SELECT d.successor_surgery_id, CONCAT('Predecessor surgery ', p.surgery_id, ' not completed')
FROM   Surgery_Dependency d JOIN Surgery p ON p.surgery_id = d.predecessor_surgery_id
WHERE  p.status <> 'Completed'
UNION ALL
SELECT se.surgery_id, CONCAT('Equipment not sterile: ', e.equipment_name)
FROM   Surgery_Equipment se JOIN Equipment e ON e.equipment_id = se.equipment_id
WHERE  e.sterile_status <> 'Sterile'
UNION ALL
SELECT a_id, CONCAT('Conflict: ', resource_name, ' double-booked with surgery ', b_id) FROM v_conflicts
UNION ALL
SELECT b_id, CONCAT('Conflict: ', resource_name, ' double-booked with surgery ', a_id) FROM v_conflicts;

CREATE OR REPLACE VIEW v_surgery_readiness_full AS
SELECT s.surgery_id, s.status, COUNT(b.reason) AS blockers,
       CASE WHEN COUNT(b.reason) = 0 THEN 'Can proceed' ELSE 'Blocked' END AS readiness
FROM   Surgery s LEFT JOIN v_surgery_blockers b ON b.surgery_id = s.surgery_id
WHERE  s.status IN ('Scheduled','Ready')
GROUP  BY s.surgery_id, s.status;

-- ---------------------------------------------------------------------
-- 5.3 Report views and the dependency chain
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_status_counts AS
SELECT status, COUNT(*) AS surgeries FROM Surgery GROUP BY status;

CREATE OR REPLACE VIEW v_pending_tasks AS
SELECT s.surgery_id, pt.name AS patient, pr.procedure_name, s.surgery_date,
       COUNT(t.task_id) AS open_tasks,
       GROUP_CONCAT(CONCAT(t.task_name, ' [', t.status, ']') ORDER BY t.task_id SEPARATOR ', ') AS tasks
FROM   Surgery s
JOIN   Patient            pt ON pt.patient_id   = s.patient_id
JOIN   Surgical_Procedure pr ON pr.procedure_id = s.procedure_id
LEFT   JOIN Pre_Op_Task t ON t.surgery_id = s.surgery_id AND t.status <> 'Completed'
WHERE  s.status NOT IN ('Completed','Cancelled')
GROUP  BY s.surgery_id, pt.name, pr.procedure_name, s.surgery_date;

-- Step number = longest path from a task that has no predecessor
CREATE OR REPLACE VIEW v_task_chain AS
WITH RECURSIVE d (task_id, depth) AS (
    SELECT t.task_id, 0 FROM Pre_Op_Task t
    WHERE NOT EXISTS (SELECT 1 FROM Task_Dependency x WHERE x.successor_task_id = t.task_id)
  UNION ALL
    SELECT x.successor_task_id, d.depth + 1
    FROM d JOIN Task_Dependency x ON x.predecessor_task_id = d.task_id
), steps AS (SELECT task_id, MAX(depth) + 1 AS step FROM d GROUP BY task_id)
SELECT t.surgery_id, st.step, t.task_id, t.task_name, t.status,
       (SELECT GROUP_CONCAT(p.task_name SEPARATOR ', ')
        FROM Task_Dependency x JOIN Pre_Op_Task p ON p.task_id = x.predecessor_task_id
        WHERE x.successor_task_id = t.task_id) AS after_tasks
FROM   Pre_Op_Task t JOIN steps st ON st.task_id = t.task_id;

-- ---------------------------------------------------------------------
-- 5.4 Stored procedures and triggers
-- ---------------------------------------------------------------------
DELIMITER $$

-- Reports tab: theatre utilization for one day (08:00-18:00 = 600 minutes)
DROP PROCEDURE IF EXISTS sp_theatre_utilization $$
CREATE PROCEDURE sp_theatre_utilization(IN p_date DATE)
BEGIN
  SELECT ot.ot_name, ot.status AS ot_status, COUNT(s.surgery_id) AS cases,
         COALESCE(SUM(p.est_duration_min), 0) AS booked_minutes,
         LEAST(100, ROUND(COALESCE(SUM(p.est_duration_min), 0) / 6)) AS utilization_pct
  FROM   Operating_Theatre ot
  LEFT   JOIN Surgery s ON s.ot_id = ot.ot_id AND s.surgery_date = p_date AND s.status <> 'Cancelled'
  LEFT   JOIN Surgical_Procedure p ON p.procedure_id = s.procedure_id
  GROUP  BY ot.ot_id, ot.ot_name, ot.status
  ORDER  BY ot.ot_id;
END $$

-- (a) Surgery: no overlapping use of surgeon / anesthetist / theatre / bed; no maintenance theatre
DROP PROCEDURE IF EXISTS sp_check_surgery_conflicts $$
CREATE PROCEDURE sp_check_surgery_conflicts(
    IN p_id INT, IN p_date DATE, IN p_start TIME, IN p_proc INT,
    IN p_surgeon INT, IN p_anes INT, IN p_ot INT, IN p_bed INT, IN p_status VARCHAR(10))
main: BEGIN
  DECLARE v_start DATETIME;
  DECLARE v_end   DATETIME;
  DECLARE v_res   VARCHAR(20) DEFAULT NULL;
  DECLARE v_other INT DEFAULT NULL;
  DECLARE v_msg   VARCHAR(128);

  IF p_status = 'Cancelled' THEN LEAVE main; END IF;
  SET v_start = TIMESTAMP(p_date, p_start);
  SELECT DATE_ADD(v_start, INTERVAL est_duration_min MINUTE) INTO v_end
  FROM Surgical_Procedure WHERE procedure_id = p_proc;

  IF EXISTS (SELECT 1 FROM Operating_Theatre WHERE ot_id = p_ot AND status = 'Maintenance') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Theatre is under maintenance';
  END IF;

  SELECT CASE WHEN o.surgeon_id     = p_surgeon THEN 'Surgeon'
              WHEN o.anesthetist_id = p_anes    THEN 'Anesthetist'
              WHEN o.ot_id          = p_ot      THEN 'Theatre'
              ELSE 'Recovery bed' END,
         o.surgery_id
  INTO   v_res, v_other
  FROM   Surgery o JOIN Surgical_Procedure p ON p.procedure_id = o.procedure_id
  WHERE  o.surgery_id <> IFNULL(p_id, -1) AND o.status <> 'Cancelled'
    AND  o.surgery_date = p_date
    AND  TIMESTAMP(o.surgery_date, o.start_time) < v_end
    AND  v_start < DATE_ADD(TIMESTAMP(o.surgery_date, o.start_time), INTERVAL p.est_duration_min MINUTE)
    AND  (o.surgeon_id = p_surgeon OR o.anesthetist_id = p_anes OR o.ot_id = p_ot OR o.bed_id = p_bed)
  LIMIT 1;

  IF v_res IS NOT NULL THEN
    SET v_msg = CONCAT(v_res, ' is already booked in overlapping surgery ', v_other);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
END $$

-- (c) Nurse / equipment cannot be assigned to two overlapping surgeries
DROP PROCEDURE IF EXISTS sp_check_nurse_booking $$
CREATE PROCEDURE sp_check_nurse_booking(IN p_surgery INT, IN p_nurse INT)
BEGIN
  IF EXISTS (SELECT 1 FROM v_overlapping_pairs ov
             JOIN Surgery_Nurse sn ON sn.surgery_id = IF(ov.a_id = p_surgery, ov.b_id, ov.a_id)
             WHERE (ov.a_id = p_surgery OR ov.b_id = p_surgery) AND sn.nurse_id = p_nurse) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Nurse is already booked in an overlapping surgery';
  END IF;
END $$

DROP PROCEDURE IF EXISTS sp_check_equipment_booking $$
CREATE PROCEDURE sp_check_equipment_booking(IN p_surgery INT, IN p_equipment INT)
BEGIN
  IF EXISTS (SELECT 1 FROM v_overlapping_pairs ov
             JOIN Surgery_Equipment se ON se.surgery_id = IF(ov.a_id = p_surgery, ov.b_id, ov.a_id)
             WHERE (ov.a_id = p_surgery OR ov.b_id = p_surgery) AND se.equipment_id = p_equipment) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Equipment is already booked in an overlapping surgery';
  END IF;
END $$

-- (e) Task dependencies: not self, same surgery only, no cycles
DROP PROCEDURE IF EXISTS sp_check_task_dependency $$
CREATE PROCEDURE sp_check_task_dependency(IN p_pred INT, IN p_succ INT)
BEGIN
  DECLARE v_a INT; DECLARE v_b INT;
  IF p_pred = p_succ THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A task cannot depend on itself';
  END IF;
  SELECT surgery_id INTO v_a FROM Pre_Op_Task WHERE task_id = p_pred;
  SELECT surgery_id INTO v_b FROM Pre_Op_Task WHERE task_id = p_succ;
  IF v_a <> v_b THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Both tasks must belong to the same surgery';
  END IF;
  IF EXISTS (WITH RECURSIVE r (t) AS (
               SELECT p_succ
               UNION
               SELECT d.successor_task_id FROM Task_Dependency d JOIN r ON d.predecessor_task_id = r.t)
             SELECT 1 FROM r WHERE t = p_pred) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This dependency would create a cycle between tasks';
  END IF;
END $$

-- (f) Surgery dependencies: not self, predecessor not dated after successor, no cycles
DROP PROCEDURE IF EXISTS sp_check_surgery_dependency $$
CREATE PROCEDURE sp_check_surgery_dependency(IN p_pred INT, IN p_succ INT)
BEGIN
  DECLARE v_pd DATE; DECLARE v_sd DATE;
  IF p_pred = p_succ THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A surgery cannot depend on itself';
  END IF;
  SELECT surgery_date INTO v_pd FROM Surgery WHERE surgery_id = p_pred;
  SELECT surgery_date INTO v_sd FROM Surgery WHERE surgery_id = p_succ;
  IF v_pd > v_sd THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Predecessor surgery is scheduled after the successor';
  END IF;
  IF EXISTS (WITH RECURSIVE r (s) AS (
               SELECT p_succ
               UNION
               SELECT d.successor_surgery_id FROM Surgery_Dependency d JOIN r ON d.predecessor_surgery_id = r.s)
             SELECT 1 FROM r WHERE s = p_pred) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This dependency would create a cycle between surgeries';
  END IF;
END $$

-- ---------- Triggers ----------
DROP TRIGGER IF EXISTS trg_surgery_bi $$
CREATE TRIGGER trg_surgery_bi BEFORE INSERT ON Surgery FOR EACH ROW
BEGIN
  CALL sp_check_surgery_conflicts(NULL, NEW.surgery_date, NEW.start_time, NEW.procedure_id,
       NEW.surgeon_id, NEW.anesthetist_id, NEW.ot_id, NEW.bed_id, NEW.status);
END $$

-- (b) Ready / Completed only when nothing blocks the surgery
DROP TRIGGER IF EXISTS trg_surgery_bu $$
CREATE TRIGGER trg_surgery_bu BEFORE UPDATE ON Surgery FOR EACH ROW
BEGIN
  DECLARE n INT DEFAULT 0;
  DECLARE first_reason VARCHAR(255);
  DECLARE v_msg VARCHAR(128);
  CALL sp_check_surgery_conflicts(NEW.surgery_id, NEW.surgery_date, NEW.start_time, NEW.procedure_id,
       NEW.surgeon_id, NEW.anesthetist_id, NEW.ot_id, NEW.bed_id, NEW.status);
  IF NEW.status IN ('Ready','Completed') AND OLD.status <> NEW.status THEN
    SELECT COUNT(*), MIN(reason) INTO n, first_reason
    FROM v_surgery_blockers WHERE surgery_id = NEW.surgery_id;
    IF n > 0 THEN
      SET v_msg = LEFT(CONCAT('Cannot mark as ', NEW.status, ' (', n, ' blocker(s)): ', first_reason), 128);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_nurse_bi $$
CREATE TRIGGER trg_nurse_bi BEFORE INSERT ON Surgery_Nurse FOR EACH ROW
BEGIN CALL sp_check_nurse_booking(NEW.surgery_id, NEW.nurse_id); END $$
DROP TRIGGER IF EXISTS trg_nurse_bu $$
CREATE TRIGGER trg_nurse_bu BEFORE UPDATE ON Surgery_Nurse FOR EACH ROW
BEGIN CALL sp_check_nurse_booking(NEW.surgery_id, NEW.nurse_id); END $$

DROP TRIGGER IF EXISTS trg_equipment_bi $$
CREATE TRIGGER trg_equipment_bi BEFORE INSERT ON Surgery_Equipment FOR EACH ROW
BEGIN CALL sp_check_equipment_booking(NEW.surgery_id, NEW.equipment_id); END $$
DROP TRIGGER IF EXISTS trg_equipment_bu $$
CREATE TRIGGER trg_equipment_bu BEFORE UPDATE ON Surgery_Equipment FOR EACH ROW
BEGIN CALL sp_check_equipment_booking(NEW.surgery_id, NEW.equipment_id); END $$

-- (d) Task status respects predecessors (Finish-to-start / Start-to-start)
DROP TRIGGER IF EXISTS trg_task_status_bu $$
CREATE TRIGGER trg_task_status_bu BEFORE UPDATE ON Pre_Op_Task FOR EACH ROW
BEGIN
  DECLARE v_blocker VARCHAR(80) DEFAULT NULL;
  DECLARE v_msg VARCHAR(128);
  IF NEW.status <> 'Pending' AND OLD.status <> NEW.status THEN
    SELECT p.task_name INTO v_blocker
    FROM Task_Dependency d JOIN Pre_Op_Task p ON p.task_id = d.predecessor_task_id
    WHERE d.successor_task_id = NEW.task_id
      AND ((d.dependency_type = 'Finish-to-start' AND p.status <> 'Completed')
        OR (d.dependency_type = 'Start-to-start'  AND p.status = 'Pending'))
    LIMIT 1;
    IF v_blocker IS NOT NULL THEN
      SET v_msg = LEFT(CONCAT('Task is blocked: predecessor "', v_blocker, '" has not progressed far enough'), 128);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_task_dep_bi $$
CREATE TRIGGER trg_task_dep_bi BEFORE INSERT ON Task_Dependency FOR EACH ROW
BEGIN CALL sp_check_task_dependency(NEW.predecessor_task_id, NEW.successor_task_id); END $$
DROP TRIGGER IF EXISTS trg_task_dep_bu $$
CREATE TRIGGER trg_task_dep_bu BEFORE UPDATE ON Task_Dependency FOR EACH ROW
BEGIN CALL sp_check_task_dependency(NEW.predecessor_task_id, NEW.successor_task_id); END $$

DROP TRIGGER IF EXISTS trg_surgery_dep_bi $$
CREATE TRIGGER trg_surgery_dep_bi BEFORE INSERT ON Surgery_Dependency FOR EACH ROW
BEGIN CALL sp_check_surgery_dependency(NEW.predecessor_surgery_id, NEW.successor_surgery_id); END $$
DROP TRIGGER IF EXISTS trg_surgery_dep_bu $$
CREATE TRIGGER trg_surgery_dep_bu BEFORE UPDATE ON Surgery_Dependency FOR EACH ROW
BEGIN CALL sp_check_surgery_dependency(NEW.predecessor_surgery_id, NEW.successor_surgery_id); END $$

DELIMITER ;

-- =====================================================================
-- Section 6: Rule demonstrations (uncomment one at a time)
-- =====================================================================
-- Reports used by the frontend
--   SELECT * FROM v_conflicts ORDER BY a_id, b_id;            -- 6 rows with the sample data
--   SELECT * FROM v_surgery_readiness_full ORDER BY surgery_id;
--   SELECT * FROM v_pending_tasks ORDER BY open_tasks DESC;
--   SELECT * FROM v_status_counts;
--   SELECT * FROM v_task_chain WHERE surgery_id = 1 ORDER BY step;
--   CALL sp_theatre_utilization('2026-10-14');
--
-- Each of these should FAIL:
--   -- overlapping surgeon (surgery 1 runs 08:00-12:00)
--   INSERT INTO Surgery (surgery_date,start_time,patient_id,procedure_id,surgeon_id,anesthetist_id,ot_id,bed_id)
--     VALUES ('2026-10-14','10:00',8,7,1,3,2,3);
--   -- theatre under maintenance (OT-5)
--   INSERT INTO Surgery (surgery_date,start_time,patient_id,procedure_id,surgeon_id,anesthetist_id,ot_id,bed_id)
--     VALUES ('2026-10-30','10:00',8,7,2,3,5,3);
--   -- nurse / equipment already booked in an overlapping surgery
--   INSERT INTO Surgery_Nurse VALUES (3,1,'Recovery nurse');
--   INSERT INTO Surgery_Equipment VALUES (3,1,1);
--   -- task started before its predecessor finished
--   UPDATE Pre_Op_Task SET status = 'Completed' WHERE task_id = 4;
--   -- dependency cycle, and dependency between tasks of different surgeries
--   INSERT INTO Task_Dependency (predecessor_task_id, successor_task_id) VALUES (4,1);
--   INSERT INTO Task_Dependency (predecessor_task_id, successor_task_id) VALUES (1,5);
--   -- surgery dependency dated the wrong way round
--   INSERT INTO Surgery_Dependency (predecessor_surgery_id, successor_surgery_id) VALUES (6,8);
--   -- marking a blocked surgery Ready
--   UPDATE Surgery SET status = 'Ready' WHERE surgery_id = 6;
--
-- These should SUCCEED:
--   UPDATE Surgery SET status = 'Ready' WHERE surgery_id = 8;        -- nothing blocks surgery 8
--   UPDATE Surgery SET status = 'Cancelled' WHERE surgery_id = 7;    -- cancelling clears a conflict
--   INSERT INTO Surgery (surgery_date,start_time,patient_id,procedure_id,surgeon_id,anesthetist_id,ot_id,bed_id)
--     VALUES ('2026-10-19','09:00',8,7,2,1,1,1);                     -- reuses cancelled surgery 9's slot
