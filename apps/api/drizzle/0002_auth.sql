-- Authentication: users and refresh-token families.
--
-- Two tables, because the refresh token is the only long-lived credential in the
-- system and it needs its own lifecycle. The access token is a short JWT and is
-- never stored anywhere.
--
-- `refresh_token.token_hash` is a SHA-256 of the opaque token, never the token
-- itself: a database dump must not be enough to impersonate a session.
--
-- `family_id` groups every token descended from one login. Rotation marks the
-- presented row `used_at` and inserts its successor in the same family. If a row
-- that already has `used_at` is presented again, the token was replayed — the
-- whole family is revoked, which logs the real user out too. That is the correct
-- trade: one forced re-login beats a live stolen session.

CREATE TYPE user_role AS ENUM ('RECEPTIONIST', 'CLINICIAN', 'ADMIN');
--> statement-breakpoint

CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinic(id),
  -- Stored lowercased by the application so this unique index is the login key.
  email         text NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  role          user_role NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, email)
);
--> statement-breakpoint

CREATE TABLE refresh_token (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  family_id  uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  CONSTRAINT refresh_token_expires_after_issue CHECK (expires_at > issued_at)
);
--> statement-breakpoint

CREATE INDEX refresh_token_family_idx ON refresh_token (family_id);
--> statement-breakpoint

CREATE INDEX refresh_token_user_idx ON refresh_token (user_id);
--> statement-breakpoint

-- Sweeping expired rows is cheap with this index and keeps the table small.
CREATE INDEX refresh_token_expires_at_idx ON refresh_token (expires_at);
