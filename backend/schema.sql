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
