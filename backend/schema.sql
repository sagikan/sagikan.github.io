CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    totp_secret TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    totp_last_step BIGINT,
    totp_pending_secret TEXT,
    mfa_failed_attempts INTEGER NOT NULL DEFAULT 0,
    mfa_locked_until TIMESTAMPTZ,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    login_locked_until TIMESTAMPTZ,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
    company TEXT NOT NULL,
    position TEXT NOT NULL,
    location TEXT NOT NULL,
    workplace_model TEXT
        CHECK (workplace_model IN (
            'On-site',
            'Hybrid',
            'Remote'
        )),
    status TEXT NOT NULL DEFAULT 'Applied'
        CHECK (status IN (
            'Applied',
            'Interview',
            'Offer',
            'Rejected',
            'Withdrawn'
        )),
    job_url TEXT,
    notes TEXT,
    applied_at DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS applications_user_id_idx
    ON applications(user_id);

CREATE TABLE IF NOT EXISTS email_verifications (
    user_id BIGINT PRIMARY KEY REFERENCES users(id)
        ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
    user_id BIGINT PRIMARY KEY REFERENCES users(id)
        ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recovery_codes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS recovery_codes_user_id_idx
    ON recovery_codes(user_id);

CREATE TABLE IF NOT EXISTS email_sync (
    user_id BIGINT PRIMARY KEY REFERENCES users(id)
        ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    auto_update BOOLEAN NOT NULL DEFAULT FALSE,
    last_ingest_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    received_at TIMESTAMPTZ,
    sender TEXT,
    subject TEXT,
    snippet TEXT,
    event_type TEXT,
    company TEXT,
    position TEXT,
    confidence REAL,
    suggested_status TEXT
        CHECK (suggested_status IN (
            'Applied',
            'Interview',
            'Offer',
            'Rejected',
            'Withdrawn'
        )),
    application_id BIGINT REFERENCES applications(id)
        ON DELETE SET NULL,
    candidate_ids BIGINT[] NOT NULL DEFAULT '{}',
    previous_status TEXT,
    state TEXT NOT NULL
        CHECK (state IN (
            'ignored',
            'pending',
            'auto_applied',
            'accepted',
            'dismissed',
            'undone'
        )),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS email_events_user_state_idx
    ON email_events(user_id, state);

CREATE TABLE IF NOT EXISTS cv_profiles (
    user_id BIGINT PRIMARY KEY REFERENCES users(id)
        ON DELETE CASCADE,
    cv JSONB NOT NULL,
    preferences JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grade_sheets (
    user_id BIGINT PRIMARY KEY REFERENCES users(id)
        ON DELETE CASCADE,
    filename TEXT NOT NULL,
    pdf BYTEA NOT NULL,
    page_count INTEGER NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_searches (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
    status TEXT NOT NULL
        CHECK (status IN (
            'running',
            'done',
            'failed'
        )),
    found INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    web_searches INTEGER,
    web_fetches INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS job_searches_user_started_idx
    ON job_searches(user_id, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS job_searches_one_running_idx
    ON job_searches(user_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
    search_id BIGINT REFERENCES job_searches(id)
        ON DELETE SET NULL,
    source TEXT NOT NULL
        CHECK (source IN ('search', 'manual')),
    company TEXT NOT NULL,
    position TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    workplace_model TEXT
        CHECK (workplace_model IN (
            'On-site',
            'Hybrid',
            'Remote'
        )),
    url TEXT,
    description TEXT NOT NULL DEFAULT '',
    match_score INTEGER,
    match_reason TEXT,
    state TEXT NOT NULL DEFAULT 'new'
        CHECK (state IN ('new', 'dismissed', 'applied')),
    application_id BIGINT REFERENCES applications(id)
        ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS match_have JSONB NOT NULL DEFAULT '[]';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS match_missing JSONB NOT NULL DEFAULT '[]';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;
-- An applied job the user removed from the Jobs page. It stays "applied" (so it's kept, with the
-- resume that was sent, for the Applications page) but isn't listed with the jobs.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS jobs_user_id_idx
    ON jobs(user_id);

CREATE INDEX IF NOT EXISTS jobs_application_id_idx
    ON jobs(application_id);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_user_url_idx
    ON jobs(user_id, url) WHERE url IS NOT NULL;

CREATE TABLE IF NOT EXISTS cv_tailorings (
    job_id BIGINT PRIMARY KEY REFERENCES jobs(id)
        ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
    cv JSONB NOT NULL,
    gaps JSONB NOT NULL DEFAULT '[]',
    flags JSONB NOT NULL DEFAULT '[]',
    include_grade_sheet BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_boards (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider TEXT NOT NULL
        CHECK (provider IN ('greenhouse', 'lever', 'ashby')),
    token TEXT NOT NULL,
    company TEXT,
    source TEXT NOT NULL
        CHECK (source IN ('seed', 'discovered', 'user')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    failures INTEGER NOT NULL DEFAULT 0,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_boards_provider_token_idx
    ON job_boards(provider, LOWER(token));

CREATE TABLE IF NOT EXISTS job_postings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    board_id BIGINT NOT NULL REFERENCES job_boards(id)
        ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    workplace_model TEXT,
    url TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    posted_at TIMESTAMPTZ,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (board_id, external_id)
);

CREATE TABLE IF NOT EXISTS feed_state (
    key TEXT PRIMARY KEY,
    updated_at TIMESTAMPTZ NOT NULL
);
