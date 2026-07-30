-- Idempotency-Key replay store for mutating endpoints.
--
-- A successful response is recorded against (clinic_id, key) so a retried
-- request with the same key returns the original status and body without
-- creating a second appointment. The request_hash catches the case where the
-- same key is reused with a *different* body, which is a client bug and must
-- 409 rather than silently return the wrong response.

CREATE TABLE idempotency_record (
  clinic_id    uuid NOT NULL REFERENCES clinic(id),
  key          text NOT NULL,
  request_hash text NOT NULL,
  method       text NOT NULL,
  path         text NOT NULL,
  status_code  smallint NOT NULL,
  response     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, key)
);
--> statement-breakpoint

CREATE INDEX idempotency_record_created_at_idx
  ON idempotency_record (created_at);
