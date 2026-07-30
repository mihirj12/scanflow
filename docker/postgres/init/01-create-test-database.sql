-- Runs once, on first initialisation of the data volume.
--
-- A separate database for tests that need a long-lived instance rather than a
-- throwaway Testcontainers one. Integration tests in CI use Testcontainers and
-- ignore this.
CREATE DATABASE scanflow_test;
