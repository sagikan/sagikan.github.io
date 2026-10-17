CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id)
        ON DELETE CASCADE,
    company TEXT NOT NULL,
    position TEXT NOT NULL,
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
