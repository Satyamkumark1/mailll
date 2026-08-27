-- Run this once against your Neon/Vercel Postgres database (e.g. via the
-- Neon SQL console in the Vercel Storage tab) before sending any email at
-- all — the send-rate limiter and sender settings both live here now, not
-- just background campaigns. See CLAUDE.md for details on each table.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running', -- running | paused | completed | canceled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  total_count INT NOT NULL,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  consecutive_failures INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0
);
-- Re-run these against an already-provisioned database — CREATE TABLE IF NOT
-- EXISTS above won't add a column to a table that already exists.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS skipped_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS campaign_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  html TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed | canceled | skipped
  error TEXT,
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS campaign_emails_due_idx ON campaign_emails (status, scheduled_at);
CREATE INDEX IF NOT EXISTS campaign_emails_campaign_idx ON campaign_emails (campaign_id);

CREATE TABLE IF NOT EXISTS send_attempts (
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS send_attempts_sent_at_idx ON send_attempts (sent_at);

-- Singleton row (id is always 1) holding the self-service sender account +
-- send caps configured via the Settings modal, replacing the old
-- EMAIL_USER/EMAIL_PASSWORD/EMAIL_HOST/EMAIL_PORT/EMAIL_HOURLY_CAP/EMAIL_DAILY_CAP
-- env vars. smtp_password_encrypted is AES-256-GCM ciphertext (see
-- lib/secret-crypto.ts), never stored or returned in plaintext.
CREATE TABLE IF NOT EXISTS sender_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  smtp_host TEXT NOT NULL,
  smtp_port INT NOT NULL,
  smtp_user TEXT NOT NULL,
  smtp_password_encrypted TEXT NOT NULL,
  hourly_cap INT NOT NULL,
  daily_cap INT NOT NULL,
  warmup_enabled BOOLEAN NOT NULL DEFAULT true,
  warmup_start_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
