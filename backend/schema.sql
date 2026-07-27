-- Idempotent schema for SubsPortal. Safe to re-run.

CREATE TABLE IF NOT EXISTS brands (
    id             BIGSERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    email          TEXT NOT NULL DEFAULT '',
    app            TEXT NOT NULL DEFAULT '',
    accent         TEXT NOT NULL DEFAULT '#4f46e5',
    aquamark_email TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funders (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL DEFAULT '',
    cc_members  JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Replaces the old funders.brands: number[] shape with a real join table.
CREATE TABLE IF NOT EXISTS funder_brands (
    funder_id BIGINT NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
    brand_id  BIGINT NOT NULL REFERENCES brands(id)  ON DELETE CASCADE,
    PRIMARY KEY (funder_id, brand_id)
);

CREATE TABLE IF NOT EXISTS teams (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    lead       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
    id       BIGSERIAL PRIMARY KEY,
    team_id  TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name     TEXT NOT NULL DEFAULT '',
    email    TEXT NOT NULL DEFAULT '',
    position INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);

CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
    token        TEXT PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Fixed roster of named funder-partner API integrations (channel/peac/ondeck/can/idea).
-- Unrelated to the `funders` table above, which is the dynamic email-routing CRM list.
CREATE TABLE IF NOT EXISTS partner_submissions (
    id                  BIGSERIAL PRIMARY KEY,
    funder_key          TEXT NOT NULL CHECK (funder_key IN ('ondeck','can','idea','channel','peac')),
    brand_name          TEXT NOT NULL,
    deal_name           TEXT NOT NULL DEFAULT '',
    created_by_user_id  BIGINT NOT NULL REFERENCES users(id),
    aquamark_job_id     TEXT NOT NULL DEFAULT '',
    external_id         TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','submitted','docs_sent','processed','error')),
    business_details    JSONB NOT NULL DEFAULT '{}'::jsonb,
    owner_details       JSONB NOT NULL DEFAULT '[]'::jsonb,
    loan_details        JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error          TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_submissions_created_by ON partner_submissions(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_partner_submissions_funder_key ON partner_submissions(funder_key);
CREATE INDEX IF NOT EXISTS idx_partner_submissions_status ON partner_submissions(status);

-- Audit trail of every attempted funder-API call per submission (masked, no secrets).
CREATE TABLE IF NOT EXISTS partner_submission_events (
    id             BIGSERIAL PRIMARY KEY,
    submission_id  BIGINT NOT NULL REFERENCES partner_submissions(id) ON DELETE CASCADE,
    action         TEXT NOT NULL,
    ok             BOOLEAN NOT NULL,
    http_status    INT,
    message        TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_submission_events_submission_id ON partner_submission_events(submission_id);

-- One brand per partner, assigned once in Funders setup. Selecting a
-- partner on the submission page auto-resolves its watermark brand/Aquamark
-- account from this table instead of the user picking a brand manually.
CREATE TABLE IF NOT EXISTS partner_brand_assignments (
    funder_key TEXT PRIMARY KEY CHECK (funder_key IN ('ondeck','can','idea','channel','peac')),
    brand_id   BIGINT REFERENCES brands(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
