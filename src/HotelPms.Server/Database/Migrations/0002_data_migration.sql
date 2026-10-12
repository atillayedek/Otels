-- Veri Aktarım Merkezi: kaynak veri doğrudan üretim tablolarına yazılmaz; önce staging'e alınır.

CREATE TABLE pms.import_mapping_profiles (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    source_type     text NOT NULL,
    entity          text NOT NULL,
    -- Yalnız alan eşleştirme ve dönüşüm ayarı içerir; işletme verisi içermez.
    mapping         jsonb NOT NULL,
    options         jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX import_profiles_name_uq ON pms.import_mapping_profiles (lower(name), entity);

CREATE TABLE pms.import_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_no          bigserial UNIQUE,
    entity          text NOT NULL CHECK (entity IN ('guests', 'companies', 'agencies', 'room_types', 'rooms', 'reservations', 'folio_history')),
    status          text NOT NULL CHECK (status IN ('analyzed', 'staged', 'validated', 'importing', 'completed', 'completed_with_errors', 'failed', 'rolled_back', 'cancelled')),
    source_type     text NOT NULL CHECK (source_type IN ('csv', 'xlsx', 'xls', 'json', 'xml', 'postgresql', 'sqlserver', 'mysql', 'sqlite', 'odbc')),
    source_label    text NOT NULL,
    -- Kaynak meta verisi: dosya adı/hash, sunucu/veritabanı adı. Parola ASLA saklanmaz.
    source_meta     jsonb NOT NULL DEFAULT '{}',
    options         jsonb NOT NULL DEFAULT '{}',
    mapping         jsonb,
    duplicate_policy text NOT NULL DEFAULT 'review' CHECK (duplicate_policy IN ('skip', 'update', 'create', 'review')),
    total_rows      integer NOT NULL DEFAULT 0,
    valid_rows      integer NOT NULL DEFAULT 0,
    imported_rows   integer NOT NULL DEFAULT 0,
    updated_rows    integer NOT NULL DEFAULT 0,
    skipped_rows    integer NOT NULL DEFAULT 0,
    failed_rows     integer NOT NULL DEFAULT 0,
    review_rows     integer NOT NULL DEFAULT 0,
    duplicate_rows  integer NOT NULL DEFAULT 0,
    backup_id       uuid REFERENCES pms.backups(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    started_at      timestamptz,
    finished_at     timestamptz,
    rolled_back_at  timestamptz,
    rolled_back_by  uuid,
    error           text,
    version         integer NOT NULL DEFAULT 1
);
CREATE INDEX import_jobs_created_idx ON pms.import_jobs (created_at DESC);

CREATE TABLE pms.import_staging_rows (
    job_id          uuid NOT NULL REFERENCES pms.import_jobs(id) ON DELETE CASCADE,
    row_no          integer NOT NULL,
    raw             jsonb NOT NULL,
    mapped          jsonb,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'valid', 'invalid', 'needs_review', 'imported', 'updated', 'skipped', 'failed')),
    duplicate_of    uuid,
    duplicate_score integer,
    duplicate_reason text,
    review_decision text CHECK (review_decision IN ('skip', 'update', 'create')),
    target_id       uuid,
    batch_no        integer,
    PRIMARY KEY (job_id, row_no)
);
CREATE INDEX import_staging_status_idx ON pms.import_staging_rows (job_id, status);

CREATE TABLE pms.import_errors (
    id              bigserial PRIMARY KEY,
    job_id          uuid NOT NULL REFERENCES pms.import_jobs(id) ON DELETE CASCADE,
    row_no          integer,
    field           text,
    value           text,
    reason          text NOT NULL,
    severity        text NOT NULL DEFAULT 'error' CHECK (severity IN ('error', 'warning'))
);
CREATE INDEX import_errors_job_idx ON pms.import_errors (job_id, row_no);

-- Rollback için: hangi kayıt oluşturuldu / güncellendi, güncellenen kaydın önceki hali.
CREATE TABLE pms.import_records (
    id              bigserial PRIMARY KEY,
    job_id          uuid NOT NULL REFERENCES pms.import_jobs(id),
    row_no          integer NOT NULL,
    entity_table    text NOT NULL,
    entity_id       uuid NOT NULL,
    action          text NOT NULL CHECK (action IN ('created', 'updated')),
    before_value    jsonb,
    after_version   integer,
    batch_no        integer NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_records_job_idx ON pms.import_records (job_id, entity_table);

CREATE TABLE pms.import_batches (
    job_id          uuid NOT NULL REFERENCES pms.import_jobs(id),
    batch_no        integer NOT NULL,
    first_row       integer NOT NULL,
    last_row        integer NOT NULL,
    status          text NOT NULL CHECK (status IN ('committed', 'failed')),
    error           text,
    committed_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, batch_no)
);
