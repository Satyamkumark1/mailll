-- Run this once against your Neon/Vercel Postgres database (e.g. via the
-- Neon SQL console in the Vercel Storage tab) before sending any email at
-- all — the send-rate limiter and sender accounts both live here now, not
-- just background campaigns. See CLAUDE.md for details on each table.
--
-- Safe to re-run against an already-provisioned database: every statement
-- below is idempotent (IF NOT EXISTS / IF EXISTS / backfills that only touch
-- rows still missing a value).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running', -- running | completed | canceled
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
  sent_at TIMESTAMPTZ,
  -- Only meaningful once status = 'sent': 'sent' just means the SMTP server
  -- accepted the message, not that the recipient's mailbox actually kept it.
  -- NULL = not yet confirmed either way (lib/bounce-checker.ts fills this in).
  delivery_status TEXT, -- null | delivered | bounced
  bounce_reason TEXT,
  bounce_checked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS campaign_emails_due_idx ON campaign_emails (status, scheduled_at);
CREATE INDEX IF NOT EXISTS campaign_emails_campaign_idx ON campaign_emails (campaign_id);
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS delivery_status TEXT;
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS bounce_reason TEXT;
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS bounce_checked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS send_attempts (
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'immediate' -- immediate | campaign
);
CREATE INDEX IF NOT EXISTS send_attempts_sent_at_idx ON send_attempts (sent_at);
ALTER TABLE send_attempts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'immediate';

-- One row per SMTP sending account, configured via the Settings modal's
-- account roster, replacing the old EMAIL_USER/EMAIL_PASSWORD/EMAIL_HOST/
-- EMAIL_PORT/EMAIL_HOURLY_CAP/EMAIL_DAILY_CAP env vars. Used to be a
-- singleton (id fixed at 1) back when the app only supported one sending
-- account; the rename + migration block below upgrades an existing
-- single-account database in place. smtp_password_encrypted is AES-256-GCM
-- ciphertext (see lib/secret-crypto.ts), never stored or returned in
-- plaintext. consecutive_failures/status drive per-account auto-pause
-- (lib/campaigns.ts) — a failing account pauses on its own without
-- affecting the other accounts' sends.
ALTER TABLE IF EXISTS sender_settings RENAME TO sender_accounts;

CREATE TABLE IF NOT EXISTS sender_accounts (
  id SERIAL PRIMARY KEY,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | paused
  smtp_host TEXT NOT NULL,
  smtp_port INT NOT NULL,
  smtp_user TEXT NOT NULL,
  smtp_password_encrypted TEXT NOT NULL,
  hourly_cap INT NOT NULL,
  daily_cap INT NOT NULL,
  warmup_enabled BOOLEAN NOT NULL DEFAULT true,
  warmup_start_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  consecutive_failures INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bookkeeping for lib/bounce-checker.ts's IMAP poll of this same mailbox
  -- for bounce-back (DSN) notifications. bounce_last_uid/bounce_uidvalidity
  -- track how far into the inbox it's already scanned, so re-polling doesn't
  -- reprocess the same messages.
  last_bounce_check_at TIMESTAMPTZ,
  bounce_last_uid BIGINT NOT NULL DEFAULT 0,
  bounce_uidvalidity BIGINT NOT NULL DEFAULT 0
);

-- Upgrades a pre-multi-account database: drops the old id=1 CHECK
-- constraint and converts the fixed default into a real sequence so more
-- rows can be inserted. No-ops on a fresh install (the constraint won't
-- exist) and on a database that's already been upgraded.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sender_settings_id_check') THEN
    ALTER TABLE sender_accounts DROP CONSTRAINT sender_settings_id_check;
    ALTER TABLE sender_accounts ALTER COLUMN id DROP DEFAULT;
    CREATE SEQUENCE IF NOT EXISTS sender_accounts_id_seq OWNED BY sender_accounts.id;
    PERFORM setval('sender_accounts_id_seq', COALESCE((SELECT MAX(id) FROM sender_accounts), 0) + 1, false);
    ALTER TABLE sender_accounts ALTER COLUMN id SET DEFAULT nextval('sender_accounts_id_seq');
  END IF;
END $$;
ALTER TABLE sender_accounts ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE sender_accounts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE sender_accounts ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
ALTER TABLE sender_accounts ADD COLUMN IF NOT EXISTS last_bounce_check_at TIMESTAMPTZ;
ALTER TABLE sender_accounts ADD COLUMN IF NOT EXISTS bounce_last_uid BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sender_accounts ADD COLUMN IF NOT EXISTS bounce_uidvalidity BIGINT NOT NULL DEFAULT 0;
UPDATE sender_accounts SET label = smtp_user WHERE label IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sender_accounts_smtp_user_key ON sender_accounts (smtp_user);

-- Ties a send attempt / a sent campaign email to the account that actually
-- sent it. Nullable: campaign_emails.account_id is only set once a row is
-- actually attempted, not when the campaign is scheduled — accounts are
-- picked dynamically per email at send time (see app/api/cron/tick).
ALTER TABLE send_attempts ADD COLUMN IF NOT EXISTS account_id INT REFERENCES sender_accounts(id) ON DELETE SET NULL;
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS account_id INT REFERENCES sender_accounts(id) ON DELETE SET NULL;

-- One-time backfill: every row that predates multi-account support was sent
-- by the single original account, which keeps id=1 across this migration.
UPDATE send_attempts SET account_id = 1
  WHERE account_id IS NULL AND EXISTS (SELECT 1 FROM sender_accounts WHERE id = 1);
UPDATE campaign_emails SET account_id = 1
  WHERE account_id IS NULL AND status IN ('sent', 'failed') AND EXISTS (SELECT 1 FROM sender_accounts WHERE id = 1);

-- Campaign-level pause/resume is retired in favor of per-account pause
-- (lib/campaigns.ts no longer sets this) — reconcile any campaign left
-- paused from before this migration so it keeps sending rather than
-- stalling forever.
UPDATE campaigns SET status = 'running' WHERE status = 'paused';

-- App Users table storing authorized user credentials
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
