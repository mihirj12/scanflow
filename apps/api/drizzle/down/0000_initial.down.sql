-- Reverses 0000_initial.sql.
--
-- Kept per the db-migration convention: if a change cannot be reversed on paper,
-- it has not been thought through. Migrations are forward-only in every
-- environment, so this is never run automatically -- it exists for local resets
-- and as a design check.
--
-- Dropped in reverse dependency order. btree_gist is left installed, because
-- another schema in the same database may depend on it.

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS schedule_version;
DROP TABLE IF EXISTS appointment_segment;
DROP TABLE IF EXISTS appointment_step;
DROP TABLE IF EXISTS appointment;
DROP TABLE IF EXISTS template_step;
DROP TABLE IF EXISTS appointment_template;
DROP TABLE IF EXISTS service_type;
DROP TABLE IF EXISTS resource_exception;
DROP TABLE IF EXISTS resource_working_hours;
DROP TABLE IF EXISTS resource;
DROP TABLE IF EXISTS patient;
DROP TABLE IF EXISTS clinic;

DROP TYPE IF EXISTS appointment_status;
DROP TYPE IF EXISTS segment_status;
DROP TYPE IF EXISTS segment_kind;
DROP TYPE IF EXISTS resource_type;
