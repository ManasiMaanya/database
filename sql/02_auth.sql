-- =====================================================================
-- Surgical Scheduling and Dependency Management System
-- Migration 02: Doctor_Account (application login table)
--
-- Additive to 01_surgical_scheduling.sql. The Review 2 schema stores the
-- clinical data; this table stores who signs in to the application.
--
-- One row per doctor: either a Surgeon or an Anesthetist, never both.
-- The password is sha256(salt || password), matching the original
-- browser prototype so the demo credentials are unchanged.
--
-- Load order:  01_surgical_scheduling.sql  ->  02_auth.sql
-- =====================================================================

USE surgical_scheduling;

CREATE TABLE IF NOT EXISTS Doctor_Account (
    account_id      INT           AUTO_INCREMENT PRIMARY KEY,
    email           VARCHAR(120)  NOT NULL UNIQUE,
    password_salt   VARCHAR(32)   NOT NULL,
    password_hash   CHAR(64)      NOT NULL,
    surgeon_id      INT           NULL,
    anesthetist_id  INT           NULL,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_account_surgeon
        FOREIGN KEY (surgeon_id) REFERENCES Surgeon(surgeon_id) ON DELETE CASCADE,
    CONSTRAINT fk_account_anesthetist
        FOREIGN KEY (anesthetist_id) REFERENCES Anesthetist(anesthetist_id) ON DELETE CASCADE,
    -- Exactly one of the two doctor columns must be set.
    CONSTRAINT chk_account_one_doctor
        CHECK ((surgeon_id IS NULL) <> (anesthetist_id IS NULL))
);

-- Idempotent seed: clear the demo logins, then insert them fresh.
DELETE FROM Doctor_Account;

INSERT INTO Doctor_Account
    (account_id, email, password_salt, password_hash, surgeon_id, anesthetist_id)
VALUES
 (1, 'rohan.iyer@hospital.test', 'ssdm01', '0b786d1f47f7539ddb55b1fb5bf4b89dbf9d61d89451b2268e658e6ab8d25746', 1, NULL),
 (2, 'meera.krishnan@hospital.test', 'ssdm02', '9a6e62b95032500b900a8549437f1fe8780f4e29fd5d0b1ac29e3bcb0c305893', 2, NULL),
 (3, 'sandeep.verma@hospital.test', 'ssdm03', '689032cf6f75e625d534bcff1a9174d6dcd7e0fa8c55617697c6cc8132865f0f', 3, NULL),
 (4, 'anita.desai@hospital.test', 'ssdm04', 'e0bfd2876b873d4968457651722ddc2c998670b152ef617a03b1a625b6b80035', 4, NULL),
 (5, 'farhan.qureshi@hospital.test', 'ssdm05', '3a8fb955c7b54f649b8e78a1fe601f7e2db39a9854d09601a72209755fd525c7', 5, NULL),
 (6, 'lakshmi.rao@hospital.test', 'ssdm06', '56bc082567a06961d1e8ccf9fae70fba563b318fedbfe5ef992bd32a1345e38f', 6, NULL),
 (7, 'kavita.menon@hospital.test', 'ssdm07', 'bf4d21d5751d1a776f55d8dfa8f58c14a7e673819c0720e870ece4d6162e5b75', NULL, 1),
 (8, 'arvind.pillai@hospital.test', 'ssdm08', 'b4a377025a9417d7e2676407cd5edd558fb462a269e0170a5c7cbece9ec38dcb', NULL, 2),
 (9, 'neha.bansal@hospital.test', 'ssdm09', '9d3e13af1a6269a90d348f76246ff16eed60b84f219e846670b6d711a668f558', NULL, 3),
 (10, 'imran.sheikh@hospital.test', 'ssdm10', '78f0b03de32c4005214ca9219dcc9e57fef5043a1c1ac4d7a826dbf38e0ef6f2', NULL, 4);

-- Keep AUTO_INCREMENT ahead of the seeded ids.
ALTER TABLE Doctor_Account AUTO_INCREMENT = 11;

-- Demo logins (password: demo1234)
SELECT account_id, email,
       CASE WHEN surgeon_id IS NOT NULL THEN 'Surgeon' ELSE 'Anesthetist' END AS role
FROM   Doctor_Account
ORDER  BY account_id;
