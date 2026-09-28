CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  pin_salt BYTEA NOT NULL,
  pin_hash BYTEA NOT NULL,
  first_name TEXT,
  birth_date DATE,
  sex TEXT CHECK (sex IS NULL OR sex IN ('female', 'male', 'intersex', 'prefer_not_to_say')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS sex TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_idx
  ON app_users (LOWER(email));

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash BYTEA PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx
  ON app_sessions (expires_at);

CREATE TABLE IF NOT EXISTS sleep_entries (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  night_date DATE NOT NULL,
  went_to_bed TIME NOT NULL,
  lights_out TIME NOT NULL,
  sleep_latency_min INTEGER NOT NULL DEFAULT 0 CHECK (sleep_latency_min BETWEEN 0 AND 720),
  awakenings INTEGER NOT NULL DEFAULT 0 CHECK (awakenings BETWEEN 0 AND 50),
  awake_during_night_min INTEGER NOT NULL DEFAULT 0 CHECK (awake_during_night_min BETWEEN 0 AND 720),
  final_wake TIME NOT NULL,
  got_out_of_bed TIME NOT NULL,
  quality SMALLINT NOT NULL CHECK (quality BETWEEN 1 AND 5),
  naps_min INTEGER NOT NULL DEFAULT 0 CHECK (naps_min BETWEEN 0 AND 720),
  caffeine_last_time TIME,
  alcohol_notes TEXT,
  alcohol_doses TEXT,
  alcohol_last_time TIME,
  cigarette_last_time TIME,
  medication_notes TEXT,
  habits JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, night_date)
);

CREATE INDEX IF NOT EXISTS sleep_entries_user_date_idx
  ON sleep_entries (user_id, night_date DESC);

ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS alcohol_doses TEXT;
ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS alcohol_last_time TIME;
ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS cigarette_last_time TIME;
ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS habits JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS sleep_programs (
  user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  current_week SMALLINT NOT NULL DEFAULT 0 CHECK (current_week BETWEEN 0 AND 4),
  safety_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  age_65_plus BOOLEAN NOT NULL DEFAULT FALSE,
  baseline_assessment JSONB,
  week4_assessment JSONB,
  fixed_wake_time TIME,
  sleep_window_min SMALLINT CHECK (sleep_window_min IS NULL OR sleep_window_min BETWEEN 300 AND 900),
  previous_window_min SMALLINT CHECK (previous_window_min IS NULL OR previous_window_min BETWEEN 300 AND 900),
  pending_window_min SMALLINT CHECK (pending_window_min IS NULL OR pending_window_min BETWEEN 300 AND 900),
  window_change_week SMALLINT,
  below_target_weeks SMALLINT NOT NULL DEFAULT 0,
  last_reviewed_week SMALLINT,
  daytime_feeling TEXT CHECK (daytime_feeling IS NULL OR daytime_feeling IN ('better', 'same', 'worse')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sleep_programs ADD COLUMN IF NOT EXISTS age_65_plus BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sleep_programs ADD COLUMN IF NOT EXISTS pending_window_min SMALLINT;
ALTER TABLE sleep_programs ADD COLUMN IF NOT EXISTS window_change_week SMALLINT;
ALTER TABLE sleep_programs ADD COLUMN IF NOT EXISTS below_target_weeks SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE sleep_programs ADD COLUMN IF NOT EXISTS last_reviewed_week SMALLINT;
