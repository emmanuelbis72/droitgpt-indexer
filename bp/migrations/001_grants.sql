-- bp/migrations/001_grants.sql
-- Production schema for DroitGPT Grants module.
-- Safe to run on PostgreSQL with pgcrypto enabled.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  organization TEXT,
  type TEXT,
  summary TEXT,
  description TEXT,
  eligibility TEXT,
  countries JSONB DEFAULT '[]'::jsonb,
  region TEXT,
  sectors JSONB DEFAULT '[]'::jsonb,
  amount TEXT,
  currency TEXT,
  deadline TIMESTAMPTZ,
  deadline_text TEXT,
  application_url TEXT,
  source_url TEXT NOT NULL UNIQUE,
  source_name TEXT,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'draft_review',
  reliability_score INT DEFAULT 0,
  verification_notes TEXT,
  raw_content TEXT,
  extracted_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT opportunities_status_check CHECK (status IN ('open', 'expired', 'unknown', 'draft_review', 'hidden')),
  CONSTRAINT opportunities_type_check CHECK (type IS NULL OR type IN ('grant', 'scholarship', 'call_for_projects', 'competition', 'accelerator', 'fellowship', 'ngo_funding', 'other')),
  CONSTRAINT opportunities_reliability_score_check CHECK (reliability_score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS opportunities_status_idx ON opportunities (status);
CREATE INDEX IF NOT EXISTS opportunities_type_idx ON opportunities (type);
CREATE INDEX IF NOT EXISTS opportunities_deadline_idx ON opportunities (deadline);
CREATE INDEX IF NOT EXISTS opportunities_source_name_idx ON opportunities (source_name);
CREATE INDEX IF NOT EXISTS opportunities_countries_gin_idx ON opportunities USING gin (countries);
CREATE INDEX IF NOT EXISTS opportunities_sectors_gin_idx ON opportunities USING gin (sectors);

CREATE TABLE IF NOT EXISTS grant_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  type TEXT,
  region TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT grant_sources_type_check CHECK (type IS NULL OR type IN ('grant', 'scholarship', 'call_for_projects', 'competition', 'accelerator', 'fellowship', 'ngo_funding', 'other'))
);

CREATE INDEX IF NOT EXISTS grant_sources_active_idx ON grant_sources (active);

CREATE TABLE IF NOT EXISTS grant_search_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'queued',
  query TEXT,
  params JSONB DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  CONSTRAINT grant_search_jobs_status_check CHECK (status IN ('queued', 'running', 'done', 'error'))
);

CREATE INDEX IF NOT EXISTS grant_search_jobs_status_idx ON grant_search_jobs (status);
CREATE INDEX IF NOT EXISTS grant_search_jobs_created_at_idx ON grant_search_jobs (created_at DESC);
