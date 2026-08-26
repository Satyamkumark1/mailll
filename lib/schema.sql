-- Run this once against your Neon/Vercel Postgres database (e.g. via the
-- Neon SQL console in the Vercel Storage tab) before using background
-- send campaigns. See CLAUDE.md "Background send campaigns" for setup.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running', -- running | completed | canceled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  total_count INT NOT NULL,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS campaign_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  html TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed | canceled
  error TEXT,
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS campaign_emails_due_idx ON campaign_emails (status, scheduled_at);
CREATE INDEX IF NOT EXISTS campaign_emails_campaign_idx ON campaign_emails (campaign_id);

CREATE TABLE IF NOT EXISTS send_attempts (
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS send_attempts_sent_at_idx ON send_attempts (sent_at);
