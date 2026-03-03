CREATE TABLE IF NOT EXISTS job_log (
  job_id      BIGSERIAL PRIMARY KEY,
  job_type    TEXT NOT NULL,
  status      TEXT CHECK (status IN ('queued','running','done','error')) NOT NULL,
  started_at  TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  payload     JSONB,
  result      JSONB
);

CREATE INDEX IF NOT EXISTS idx_job_log_type_time ON job_log(job_type, started_at DESC);

