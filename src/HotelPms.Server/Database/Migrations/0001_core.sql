-- HotelPMS çekirdek şema. Para: numeric(18,2). Zaman: timestamptz (UTC). Gece tarihleri: date.
-- Bu migration yalnız sistem yapılandırmasını (rol/izin kataloğu, sistem ödeme tipleri) ekler; işletme verisi eklemez.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS pms;

-- ---------------------------------------------------------------- Tesis
CREATE TABLE pms.property (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    legal_name      text,
    tax_office      text,
    tax_number      text,
    address         text,
    city            text,
    country         char(2) NOT NULL DEFAULT 'TR',
    phone           text,
    email           text,
    time_zone       text NOT NULL,
    currency        char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    business_date   date NOT NULL,
    check_in_time   time NOT NULL DEFAULT '14:00',
    check_out_time  time NOT NULL DEFAULT '12:00',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);

CREATE TABLE pms.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid
);

-- ---------------------------------------------------------------- Kullanıcı / RBAC
CREATE TABLE pms.permissions (
    code        text PRIMARY KEY,
    module      text NOT NULL,
    description text NOT NULL
);

CREATE TABLE pms.roles (
    code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
    name        text NOT NULL,
    is_system   boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pms.role_permissions (
    role_code       text NOT NULL REFERENCES pms.roles(code) ON DELETE CASCADE,
    permission_code text NOT NULL REFERENCES pms.permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE pms.users (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username                text NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
    full_name               text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
    email                   text,
    password_hash           text NOT NULL,
    is_active               boolean NOT NULL DEFAULT true,
    must_change_password    boolean NOT NULL DEFAULT false,
    failed_attempts         integer NOT NULL DEFAULT 0,
    locked_until            timestamptz,
    last_login_at           timestamptz,
    password_changed_at     timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    version                 integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX users_username_uq ON pms.users (lower(username));

CREATE TABLE pms.user_roles (
    user_id     uuid NOT NULL REFERENCES pms.users(id) ON DELETE CASCADE,
    role_code   text NOT NULL REFERENCES pms.roles(code),
    PRIMARY KEY (user_id, role_code)
);

CREATE TABLE pms.devices (
    id              uuid PRIMARY KEY,
    name            text NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('client', 'browser')),
    hostname        text,
    last_ip         inet,
    client_version  text,
    last_user_id    uuid REFERENCES pms.users(id) ON DELETE SET NULL,
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    registered_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    revoked_at      timestamptz,
    revoked_by      uuid REFERENCES pms.users(id) ON DELETE SET NULL
);

CREATE TABLE pms.sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES pms.users(id) ON DELETE CASCADE,
    token_hash      bytea NOT NULL UNIQUE,
    device_id       uuid REFERENCES pms.devices(id) ON DELETE SET NULL,
    ip              inet,
    user_agent      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    revoke_reason   text
);
CREATE INDEX sessions_user_idx ON pms.sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE pms.login_attempts (
    id          bigserial PRIMARY KEY,
    username    text NOT NULL,
    ip          inet,
    success     boolean NOT NULL,
    at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_ip_idx ON pms.login_attempts (ip, at DESC);

-- ---------------------------------------------------------------- Audit (silinemez)
CREATE TABLE pms.audit_log (
    id              bigserial PRIMARY KEY,
    at              timestamptz NOT NULL DEFAULT now(),
    user_id         uuid,
    username        text,
    device_id       uuid,
    hostname        text,
    ip              inet,
    action          text NOT NULL,
    entity_type     text,
    entity_id       text,
    old_value       jsonb,
    new_value       jsonb,
    reason          text,
    correlation_id  text
);
CREATE INDEX audit_log_at_idx ON pms.audit_log (at DESC);
CREATE INDEX audit_log_entity_idx ON pms.audit_log (entity_type, entity_id);
CREATE INDEX audit_log_user_idx ON pms.audit_log (user_id, at DESC);

CREATE FUNCTION pms.audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log kayıtları değiştirilemez veya silinemez' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON pms.audit_log
    FOR EACH ROW EXECUTE FUNCTION pms.audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON pms.audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION pms.audit_log_immutable();

-- ---------------------------------------------------------------- Idempotency
CREATE TABLE pms.idempotency_keys (
    user_id         uuid NOT NULL,
    key             text NOT NULL CHECK (length(key) BETWEEN 8 AND 100),
    action          text NOT NULL,
    request_hash    text NOT NULL,
    status_code     integer NOT NULL,
    response        jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_created_idx ON pms.idempotency_keys (created_at);

-- ---------------------------------------------------------------- Oda yapısı
CREATE TABLE pms.room_types (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,12}$'),
    name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    description     text,
    max_adults      integer NOT NULL DEFAULT 2 CHECK (max_adults BETWEEN 1 AND 30),
    max_children    integer NOT NULL DEFAULT 0 CHECK (max_children BETWEEN 0 AND 30),
    default_rate    numeric(18,2) NOT NULL DEFAULT 0 CHECK (default_rate >= 0),
    sort_order      integer NOT NULL DEFAULT 0,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    migration_job_id uuid, migration_source text, migration_source_id text
);
CREATE UNIQUE INDEX room_types_code_uq ON pms.room_types (code);

CREATE TABLE pms.rooms (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_type_id    uuid NOT NULL REFERENCES pms.room_types(id),
    number          text NOT NULL CHECK (number ~ '^[A-Za-z0-9_-]{1,10}$'),
    floor           text,
    description     text,
    features        text,
    hk_status       text NOT NULL DEFAULT 'dirty' CHECK (hk_status IN ('clean', 'dirty', 'inspected', 'cleaning')),
    is_dnd          boolean NOT NULL DEFAULT false,
    hk_note         text,
    hk_updated_at   timestamptz,
    hk_updated_by   uuid REFERENCES pms.users(id) ON DELETE SET NULL,
    sort_order      integer NOT NULL DEFAULT 0,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    migration_job_id uuid, migration_source text, migration_source_id text
);
CREATE UNIQUE INDEX rooms_number_uq ON pms.rooms (upper(number));
CREATE INDEX rooms_type_idx ON pms.rooms (room_type_id);

-- ---------------------------------------------------------------- Bakım ve blokaj
CREATE TABLE pms.maintenance_tickets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_no       bigserial UNIQUE,
    room_id         uuid REFERENCES pms.rooms(id),
    location        text,
    issue           text NOT NULL CHECK (length(btrim(issue)) BETWEEN 1 AND 200),
    description     text,
    priority        text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'cancelled')),
    assigned_user_id uuid REFERENCES pms.users(id) ON DELETE SET NULL,
    opened_at       timestamptz NOT NULL DEFAULT now(),
    opened_by       uuid REFERENCES pms.users(id) ON DELETE SET NULL,
    resolved_at     timestamptz,
    resolved_by     uuid REFERENCES pms.users(id) ON DELETE SET NULL,
    notes           text,
    version         integer NOT NULL DEFAULT 1,
    migration_job_id uuid, migration_source text, migration_source_id text,
    CHECK (room_id IS NOT NULL OR location IS NOT NULL)
);
CREATE INDEX maintenance_status_idx ON pms.maintenance_tickets (status, priority);

CREATE TABLE pms.room_blocks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         uuid NOT NULL REFERENCES pms.rooms(id),
    kind            text NOT NULL CHECK (kind IN ('out_of_order', 'out_of_service', 'blocked')),
    date_from       date NOT NULL,
    date_to         date NOT NULL,
    reason          text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 300),
    ticket_id       uuid REFERENCES pms.maintenance_tickets(id),
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid REFERENCES pms.users(id) ON DELETE SET NULL,
    released_at     timestamptz,
    released_by     uuid REFERENCES pms.users(id) ON DELETE SET NULL,
    CHECK (date_from < date_to),
    CONSTRAINT room_blocks_no_overlap EXCLUDE USING gist (room_id WITH =, daterange(date_from, date_to) WITH &&) WHERE (is_active)
);

CREATE TABLE pms.hk_tasks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         uuid NOT NULL REFERENCES pms.rooms(id),
    task_type       text NOT NULL CHECK (task_type IN ('departure_clean', 'stayover_clean', 'inspection', 'turndown', 'deep_clean', 'other')),
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
    business_date   date NOT NULL,
    assigned_user_id uuid REFERENCES pms.users(id) ON DELETE SET NULL,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid REFERENCES pms.users(id) ON DELETE SET NULL,
    completed_at    timestamptz,
    completed_by    uuid REFERENCES pms.users(id) ON DELETE SET NULL,
    version         integer NOT NULL DEFAULT 1
);
CREATE INDEX hk_tasks_date_idx ON pms.hk_tasks (business_date, status);
CREATE INDEX hk_tasks_room_idx ON pms.hk_tasks (room_id, status);

-- ---------------------------------------------------------------- Şirket / Acente
CREATE TABLE pms.companies (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text,
    name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    tax_office      text,
    tax_number      text,
    address         text,
    city            text,
    country         char(2),
    phone           text,
    email           text,
    contact_name    text,
    credit_limit    numeric(18,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
    is_city_ledger  boolean NOT NULL DEFAULT false,
    notes           text,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    migration_job_id uuid, migration_source text, migration_source_id text
);
CREATE UNIQUE INDEX companies_code_uq ON pms.companies (upper(code)) WHERE code IS NOT NULL;
CREATE INDEX companies_name_trgm ON pms.companies USING gin (name gin_trgm_ops);

CREATE TABLE pms.agencies (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text,
    name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    tax_office      text,
    tax_number      text,
    address         text,
    city            text,
    country         char(2),
    phone           text,
    email           text,
    contact_name    text,
    commission_rate numeric(5,2) CHECK (commission_rate IS NULL OR commission_rate BETWEEN 0 AND 100),
    credit_limit    numeric(18,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
    notes           text,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    migration_job_id uuid, migration_source text, migration_source_id text
);
CREATE UNIQUE INDEX agencies_code_uq ON pms.agencies (upper(code)) WHERE code IS NOT NULL;
CREATE INDEX agencies_name_trgm ON pms.agencies USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------- Misafir
CREATE TABLE pms.guests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name          text NOT NULL CHECK (length(btrim(first_name)) BETWEEN 1 AND 100),
    last_name           text NOT NULL CHECK (length(btrim(last_name)) BETWEEN 1 AND 100),
    gender              text CHECK (gender IN ('male', 'female', 'other')),
    birth_date          date,
    birth_place         text,
    father_name         text,
    mother_name         text,
    nationality         char(2),
    identity_type       text CHECK (identity_type IN ('tckn', 'passport', 'id_card', 'driver_license', 'other')),
    identity_number     text,
    identity_country    char(2),
    identity_expiry     date,
    phone               text,
    phone_normalized    text,
    email               text,
    address             text,
    city                text,
    country             char(2),
    company_id          uuid REFERENCES pms.companies(id) ON DELETE SET NULL,
    notes               text,
    preferences         text,
    is_vip              boolean NOT NULL DEFAULT false,
    vip_level           text,
    is_blacklisted      boolean NOT NULL DEFAULT false,
    blacklist_reason    text,
    kvkk_consent        boolean NOT NULL DEFAULT false,
    kvkk_consent_at     timestamptz,
    marketing_consent   boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    version             integer NOT NULL DEFAULT 1,
    migration_job_id    uuid, migration_source text, migration_source_id text,
    CHECK (NOT is_blacklisted OR blacklist_reason IS NOT NULL)
);
CREATE INDEX guests_name_trgm ON pms.guests USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX guests_last_name_idx ON pms.guests (lower(last_name), lower(first_name));
CREATE INDEX guests_identity_idx ON pms.guests (identity_number) WHERE identity_number IS NOT NULL;
CREATE INDEX guests_phone_idx ON pms.guests (phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX guests_email_idx ON pms.guests (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX guests_migration_idx ON pms.guests (migration_job_id) WHERE migration_job_id IS NOT NULL;

-- ---------------------------------------------------------------- Fiyat
CREATE TABLE pms.rate_plans (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,16}$'),
    name            text NOT NULL,
    meal_plan       text NOT NULL DEFAULT 'RO' CHECK (meal_plan IN ('RO', 'BB', 'HB', 'FB', 'AI', 'UAI')),
    description     text,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX rate_plans_code_uq ON pms.rate_plans (code);

CREATE TABLE pms.rate_plan_prices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rate_plan_id    uuid NOT NULL REFERENCES pms.rate_plans(id) ON DELETE CASCADE,
    room_type_id    uuid NOT NULL REFERENCES pms.room_types(id),
    date_from       date NOT NULL,
    date_to         date NOT NULL,
    price           numeric(18,2) NOT NULL CHECK (price >= 0),
    min_stay        integer CHECK (min_stay IS NULL OR min_stay >= 1),
    CHECK (date_from < date_to),
    CONSTRAINT rate_plan_prices_no_overlap EXCLUDE USING gist (rate_plan_id WITH =, room_type_id WITH =, daterange(date_from, date_to) WITH &&)
);

-- ---------------------------------------------------------------- Rezervasyon / konaklama
CREATE SEQUENCE pms.reservation_number_seq START 1000;
CREATE SEQUENCE pms.folio_number_seq START 1000;

CREATE TABLE pms.reservation_groups (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_number    text NOT NULL UNIQUE,
    name            text NOT NULL,
    company_id      uuid REFERENCES pms.companies(id),
    agency_id       uuid REFERENCES pms.agencies(id),
    contact_name    text,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    version         integer NOT NULL DEFAULT 1
);

CREATE TABLE pms.reservations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_number  text NOT NULL,
    status              text NOT NULL CHECK (status IN ('tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
    guest_id            uuid NOT NULL REFERENCES pms.guests(id),
    company_id          uuid REFERENCES pms.companies(id),
    agency_id           uuid REFERENCES pms.agencies(id),
    group_id            uuid REFERENCES pms.reservation_groups(id),
    room_type_id        uuid NOT NULL REFERENCES pms.room_types(id),
    room_id             uuid REFERENCES pms.rooms(id),
    arrival             date NOT NULL,
    departure           date NOT NULL,
    adults              integer NOT NULL CHECK (adults BETWEEN 1 AND 30),
    children            integer NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 30),
    rate_plan_id        uuid REFERENCES pms.rate_plans(id),
    nightly_rate        numeric(18,2) NOT NULL CHECK (nightly_rate >= 0),
    currency            char(3) NOT NULL,
    meal_plan           text NOT NULL DEFAULT 'RO' CHECK (meal_plan IN ('RO', 'BB', 'HB', 'FB', 'AI', 'UAI')),
    source              text NOT NULL DEFAULT 'direct' CHECK (source IN ('direct', 'walk_in', 'phone', 'email', 'web', 'agency', 'company', 'ota', 'migration', 'other')),
    market              text,
    segment             text,
    is_walk_in          boolean NOT NULL DEFAULT false,
    eta                 time,
    etd                 time,
    room_charge_window  integer NOT NULL DEFAULT 1 CHECK (room_charge_window BETWEEN 1 AND 9),
    notes               text,
    special_requests    text,
    deposit_required    numeric(18,2) NOT NULL DEFAULT 0 CHECK (deposit_required >= 0),
    option_until        date,
    checked_in_at       timestamptz,
    checked_in_by       uuid,
    checked_out_at      timestamptz,
    checked_out_by      uuid,
    cancelled_at        timestamptz,
    cancelled_by        uuid,
    cancel_reason       text,
    cancelled_on        date,
    no_show_at          timestamptz,
    no_show_on          date,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    version             integer NOT NULL DEFAULT 1,
    migration_job_id    uuid, migration_source text, migration_source_id text,
    CHECK (arrival < departure),
    CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
    -- Aynı fiziksel oda aynı gece için iki aktif konaklamaya atanamaz; çıkış günü bir sonraki girişle çakışmaz.
    CONSTRAINT reservations_room_no_overlap EXCLUDE USING gist (room_id WITH =, daterange(arrival, departure) WITH &&)
        WHERE (room_id IS NOT NULL AND status IN ('tentative', 'confirmed', 'checked_in'))
);
CREATE UNIQUE INDEX reservations_number_uq ON pms.reservations (reservation_number);
CREATE INDEX reservations_dates_idx ON pms.reservations (arrival, departure) WHERE status IN ('tentative', 'confirmed', 'checked_in');
CREATE INDEX reservations_status_idx ON pms.reservations (status, arrival);
CREATE INDEX reservations_departure_idx ON pms.reservations (departure, status);
CREATE INDEX reservations_guest_idx ON pms.reservations (guest_id);
CREATE INDEX reservations_room_idx ON pms.reservations (room_id) WHERE room_id IS NOT NULL;
CREATE INDEX reservations_company_idx ON pms.reservations (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX reservations_agency_idx ON pms.reservations (agency_id) WHERE agency_id IS NOT NULL;
CREATE INDEX reservations_group_idx ON pms.reservations (group_id) WHERE group_id IS NOT NULL;
-- Aktif oda: bir oda aynı anda yalnız bir in-house konaklamaya sahip olabilir.
CREATE UNIQUE INDEX reservations_inhouse_room_uq ON pms.reservations (room_id) WHERE status = 'checked_in';

-- Gece bazlı anlaşmalı fiyat. Gece denetimi her gece için bu tablodaki tutarı postalar.
CREATE TABLE pms.reservation_rates (
    reservation_id  uuid NOT NULL REFERENCES pms.reservations(id) ON DELETE CASCADE,
    stay_date       date NOT NULL,
    rate            numeric(18,2) NOT NULL CHECK (rate >= 0),
    PRIMARY KEY (reservation_id, stay_date)
);

CREATE TABLE pms.reservation_guests (
    reservation_id  uuid NOT NULL REFERENCES pms.reservations(id) ON DELETE CASCADE,
    guest_id        uuid NOT NULL REFERENCES pms.guests(id),
    is_primary      boolean NOT NULL DEFAULT false,
    added_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (reservation_id, guest_id)
);
CREATE INDEX reservation_guests_guest_idx ON pms.reservation_guests (guest_id);

CREATE TABLE pms.room_assignments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id  uuid NOT NULL REFERENCES pms.reservations(id),
    room_id         uuid NOT NULL REFERENCES pms.rooms(id),
    from_room_id    uuid REFERENCES pms.rooms(id),
    kind            text NOT NULL CHECK (kind IN ('assign', 'move', 'upgrade', 'downgrade', 'unassign')),
    reason          text,
    at              timestamptz NOT NULL DEFAULT now(),
    by_user         uuid
);
CREATE INDEX room_assignments_res_idx ON pms.room_assignments (reservation_id, at);

CREATE TABLE pms.wakeup_calls (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id  uuid NOT NULL REFERENCES pms.reservations(id),
    call_at         timestamptz NOT NULL,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    done_at         timestamptz,
    done_by         uuid
);
CREATE INDEX wakeup_calls_pending_idx ON pms.wakeup_calls (call_at) WHERE status = 'pending';

-- ---------------------------------------------------------------- Finans
CREATE TABLE pms.transaction_codes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,16}$'),
    name            text NOT NULL,
    category        text NOT NULL CHECK (category IN ('room', 'food_beverage', 'minibar', 'laundry', 'telephone', 'spa', 'transfer', 'misc', 'tax', 'package')),
    default_price   numeric(18,2) CHECK (default_price IS NULL OR default_price >= 0),
    vat_rate        numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate BETWEEN 0 AND 100),
    is_system       boolean NOT NULL DEFAULT false,
    is_active       boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX transaction_codes_code_uq ON pms.transaction_codes (code);

CREATE TABLE pms.payment_methods (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,16}$'),
    name                text NOT NULL,
    kind                text NOT NULL CHECK (kind IN ('cash', 'credit_card', 'bank_transfer', 'city_ledger', 'company', 'agency', 'other')),
    requires_reference  boolean NOT NULL DEFAULT false,
    is_system           boolean NOT NULL DEFAULT false,
    is_active           boolean NOT NULL DEFAULT true,
    sort_order          integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX payment_methods_code_uq ON pms.payment_methods (code);

CREATE TABLE pms.cashier_shifts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_no        bigserial UNIQUE,
    user_id         uuid NOT NULL REFERENCES pms.users(id),
    business_date   date NOT NULL,
    opened_at       timestamptz NOT NULL DEFAULT now(),
    opening_float   numeric(18,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
    closed_at       timestamptz,
    counted_cash    numeric(18,2),
    expected_cash   numeric(18,2),
    difference      numeric(18,2),
    close_note      text,
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
);
CREATE UNIQUE INDEX cashier_shifts_one_open_uq ON pms.cashier_shifts (user_id) WHERE status = 'open';

CREATE TABLE pms.folios (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    folio_number    text NOT NULL UNIQUE,
    reservation_id  uuid REFERENCES pms.reservations(id),
    window_no       integer NOT NULL DEFAULT 1 CHECK (window_no BETWEEN 1 AND 9),
    payer_kind      text NOT NULL DEFAULT 'guest' CHECK (payer_kind IN ('guest', 'company', 'agency', 'house')),
    guest_id        uuid REFERENCES pms.guests(id),
    company_id      uuid REFERENCES pms.companies(id),
    agency_id       uuid REFERENCES pms.agencies(id),
    name            text NOT NULL,
    currency        char(3) NOT NULL,
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    closed_at       timestamptz,
    closed_by       uuid,
    -- Resmi fatura harici muhasebe/e-belge sisteminde düzenlenir; burada yalnız referansı tutulur.
    invoice_number  text,
    invoice_date    date,
    version         integer NOT NULL DEFAULT 1,
    migration_job_id uuid, migration_source text, migration_source_id text,
    CHECK (payer_kind <> 'company' OR company_id IS NOT NULL),
    CHECK (payer_kind <> 'agency' OR agency_id IS NOT NULL)
);
CREATE UNIQUE INDEX folios_res_window_uq ON pms.folios (reservation_id, window_no) WHERE reservation_id IS NOT NULL;
CREATE INDEX folios_company_idx ON pms.folios (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX folios_agency_idx ON pms.folios (agency_id) WHERE agency_id IS NOT NULL;
CREATE INDEX folios_status_idx ON pms.folios (status);

-- Folyo satırları değiştirilemez: düzeltme her zaman yeni ters kayıtla yapılır.
-- İşaret: charge/refund/transfer_in pozitif; payment/discount/allowance/deposit/transfer_out negatif; void = orijinalin tersi.
CREATE TABLE pms.folio_lines (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    folio_id            uuid NOT NULL REFERENCES pms.folios(id),
    line_type           text NOT NULL CHECK (line_type IN ('charge', 'payment', 'refund', 'discount', 'allowance', 'deposit', 'void', 'transfer_in', 'transfer_out')),
    transaction_code_id uuid REFERENCES pms.transaction_codes(id),
    payment_method_id   uuid REFERENCES pms.payment_methods(id),
    description         text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 300),
    quantity            numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price          numeric(18,2),
    amount              numeric(18,2) NOT NULL CHECK (amount <> 0),
    vat_rate            numeric(5,2),
    currency            char(3) NOT NULL,
    business_date       date NOT NULL,
    posted_at           timestamptz NOT NULL DEFAULT now(),
    user_id             uuid,
    device_id           uuid,
    cashier_shift_id    uuid REFERENCES pms.cashier_shifts(id),
    reference           text,
    reason              text,
    related_line_id     uuid REFERENCES pms.folio_lines(id),
    room_number         text,
    is_room_charge      boolean NOT NULL DEFAULT false,
    migration_job_id    uuid, migration_source text, migration_source_id text,
    CHECK ((line_type IN ('charge', 'refund', 'transfer_in') AND amount > 0)
        OR (line_type IN ('payment', 'discount', 'allowance', 'deposit', 'transfer_out') AND amount < 0)
        OR line_type = 'void'),
    CHECK (line_type NOT IN ('payment', 'refund', 'deposit') OR payment_method_id IS NOT NULL),
    CHECK (line_type NOT IN ('void', 'refund', 'transfer_in', 'transfer_out', 'discount', 'allowance') OR reason IS NOT NULL OR migration_job_id IS NOT NULL)
);
CREATE INDEX folio_lines_folio_idx ON pms.folio_lines (folio_id, posted_at);
CREATE INDEX folio_lines_bdate_idx ON pms.folio_lines (business_date, line_type);
CREATE INDEX folio_lines_shift_idx ON pms.folio_lines (cashier_shift_id) WHERE cashier_shift_id IS NOT NULL;
CREATE UNIQUE INDEX folio_lines_single_void_uq ON pms.folio_lines (related_line_id) WHERE line_type = 'void';
CREATE INDEX folio_lines_related_idx ON pms.folio_lines (related_line_id) WHERE related_line_id IS NOT NULL;

CREATE FUNCTION pms.folio_lines_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('pms.allow_import_rollback', true) = 'on' AND TG_OP = 'DELETE' AND OLD.migration_job_id IS NOT NULL THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Folyo satırları değiştirilemez; düzeltme için ters kayıt kullanın' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER folio_lines_no_update BEFORE UPDATE OR DELETE ON pms.folio_lines
    FOR EACH ROW EXECUTE FUNCTION pms.folio_lines_immutable();

-- Her konaklama gecesi için tek oda ücreti.
CREATE TABLE pms.room_charge_postings (
    reservation_id  uuid NOT NULL REFERENCES pms.reservations(id),
    business_date   date NOT NULL,
    folio_line_id   uuid NOT NULL REFERENCES pms.folio_lines(id),
    PRIMARY KEY (reservation_id, business_date)
);

-- ---------------------------------------------------------------- Gece denetimi
CREATE TABLE pms.night_audits (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_date   date NOT NULL UNIQUE,
    status          text NOT NULL CHECK (status IN ('completed')),
    started_at      timestamptz NOT NULL,
    completed_at    timestamptz NOT NULL DEFAULT now(),
    user_id         uuid NOT NULL,
    summary         jsonb NOT NULL,
    warnings        jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE pms.daily_statistics (
    business_date       date PRIMARY KEY,
    rooms_total         integer NOT NULL,
    rooms_out_of_order  integer NOT NULL,
    rooms_available     integer NOT NULL,
    rooms_sold          integer NOT NULL,
    complimentary       integer NOT NULL DEFAULT 0,
    guests_in_house     integer NOT NULL,
    arrivals            integer NOT NULL,
    departures          integer NOT NULL,
    no_shows            integer NOT NULL,
    cancellations       integer NOT NULL,
    room_revenue        numeric(18,2) NOT NULL,
    other_revenue       numeric(18,2) NOT NULL,
    payments            numeric(18,2) NOT NULL,
    occupancy_pct       numeric(7,2) NOT NULL,
    adr                 numeric(18,2) NOT NULL,
    revpar              numeric(18,2) NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- KBS / entegrasyon
CREATE TABLE pms.integrations (
    code            text PRIMARY KEY,
    enabled         boolean NOT NULL DEFAULT false,
    settings        jsonb NOT NULL DEFAULT '{}',
    secret_cipher   bytea,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid
);

CREATE TABLE pms.identity_reports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id  uuid NOT NULL REFERENCES pms.reservations(id),
    guest_id        uuid NOT NULL REFERENCES pms.guests(id),
    event           text NOT NULL CHECK (event IN ('check_in', 'check_out', 'room_change')),
    status          text NOT NULL CHECK (status IN ('needs_data', 'blocked_configuration', 'queued', 'processing', 'sent_awaiting_confirmation',
                        'accepted', 'retry_scheduled', 'rejected', 'outcome_unknown', 'manual_action_required', 'reported_manually', 'superseded')),
    provider        text,
    provider_reference text,
    manual_reference text,
    manual_reason   text,
    attempts        integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid,
    CHECK (status <> 'reported_manually' OR (manual_reference IS NOT NULL AND manual_reason IS NOT NULL))
);
CREATE INDEX identity_reports_status_idx ON pms.identity_reports (status, created_at);

-- ---------------------------------------------------------------- Belgeler
CREATE TABLE pms.documents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     text NOT NULL CHECK (entity_type IN ('guest', 'reservation', 'company', 'agency', 'maintenance', 'folio')),
    entity_id       uuid NOT NULL,
    category        text NOT NULL DEFAULT 'other',
    original_name   text NOT NULL,
    mime_type       text NOT NULL,
    size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
    sha256          text NOT NULL,
    object_key      uuid NOT NULL UNIQUE,
    uploaded_at     timestamptz NOT NULL DEFAULT now(),
    uploaded_by     uuid,
    deleted_at      timestamptz,
    deleted_by      uuid
);
CREATE INDEX documents_entity_idx ON pms.documents (entity_type, entity_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------- Yedekleme kayıtları
CREATE TABLE pms.backups (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            text NOT NULL CHECK (kind IN ('manual', 'scheduled', 'pre_update', 'pre_migration', 'pre_restore', 'pre_import', 'pre_schema')),
    file_name       text NOT NULL,
    directory       text NOT NULL,
    size_bytes      bigint,
    sha256          text,
    schema_version  text NOT NULL,
    app_version     text NOT NULL,
    status          text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    error           text,
    secondary_status text,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    user_id         uuid
);
CREATE INDEX backups_started_idx ON pms.backups (started_at DESC);

-- ---------------------------------------------------------------- Sistem kataloğu
INSERT INTO pms.permissions (code, module, description) VALUES
 ('dashboard.view', 'dashboard', 'Gösterge panelini görüntüle'),
 ('reservation.view', 'reservation', 'Rezervasyonları görüntüle'),
 ('reservation.create', 'reservation', 'Rezervasyon oluştur'),
 ('reservation.edit', 'reservation', 'Rezervasyon düzenle'),
 ('reservation.cancel', 'reservation', 'Rezervasyon iptal / no-show'),
 ('reservation.overbook', 'reservation', 'Müsaitlik aşımına izin ver'),
 ('rate.override', 'reservation', 'Fiyat planı dışı fiyat gir'),
 ('checkin.execute', 'frontoffice', 'Check-in yap'),
 ('checkout.execute', 'frontoffice', 'Check-out yap'),
 ('room.change', 'frontoffice', 'Oda değiştir / ata'),
 ('guest.view', 'guest', 'Misafir profillerini görüntüle'),
 ('guest.edit', 'guest', 'Misafir profili oluştur/düzenle'),
 ('guest.identity.view', 'guest', 'Kimlik/pasaport numarasını maskesiz gör'),
 ('guest.blacklist', 'guest', 'Kara liste yönetimi'),
 ('company.manage', 'sales', 'Şirket ve acente yönetimi'),
 ('rate.manage', 'sales', 'Fiyat planı yönetimi'),
 ('folio.view', 'finance', 'Folyoları görüntüle'),
 ('folio.post', 'finance', 'Folyoya masraf gir'),
 ('folio.discount', 'finance', 'İndirim / allowance'),
 ('folio.void', 'finance', 'Folyo satırı iptal (void)'),
 ('folio.transfer', 'finance', 'Folyolar arası aktarım'),
 ('folio.close', 'finance', 'Folyo kapat / aç'),
 ('payment.create', 'finance', 'Tahsilat al'),
 ('payment.refund', 'finance', 'İade yap'),
 ('cashier.manage', 'finance', 'Kasa aç/kapat'),
 ('cashier.view_all', 'finance', 'Tüm kasiyer vardiyalarını gör'),
 ('housekeeping.view', 'housekeeping', 'Kat hizmetleri ekranı'),
 ('housekeeping.update', 'housekeeping', 'Oda temizlik durumu değiştir'),
 ('housekeeping.inspect', 'housekeeping', 'Odayı kontrol edildi (inspected) olarak onayla'),
 ('housekeeping.assign', 'housekeeping', 'Görev ata'),
 ('maintenance.view', 'maintenance', 'Arıza kayıtlarını gör'),
 ('maintenance.manage', 'maintenance', 'Arıza kaydı / oda blokajı yönet'),
 ('night_audit.execute', 'night_audit', 'Gece denetimi çalıştır'),
 ('report.view', 'report', 'Operasyon raporları'),
 ('financial_report.view', 'report', 'Finansal raporlar'),
 ('kbs.manage', 'kbs', 'KBS bildirimleri yönetimi'),
 ('user.manage', 'admin', 'Kullanıcı ve rol yönetimi'),
 ('device.manage', 'admin', 'Cihaz yönetimi'),
 ('settings.manage', 'admin', 'Sistem ayarları'),
 ('room.manage', 'admin', 'Oda ve oda tipi tanımları'),
 ('backup.manage', 'admin', 'Yedekleme ve geri yükleme'),
 ('audit.view', 'admin', 'Denetim kayıtlarını görüntüle'),
 ('migration.manage', 'admin', 'Veri aktarımı'),
 ('integration.manage', 'admin', 'Entegrasyon ayarları'),
 ('printer.manage', 'admin', 'Yazıcı ayarları');

INSERT INTO pms.roles (code, name, is_system) VALUES
 ('SUPER_ADMIN', 'Süper Yönetici', true),
 ('HOTEL_ADMIN', 'Otel Yöneticisi', true),
 ('GENERAL_MANAGER', 'Genel Müdür', true),
 ('FRONT_OFFICE_MANAGER', 'Ön Büro Müdürü', true),
 ('RECEPTION', 'Resepsiyon', true),
 ('NIGHT_AUDIT', 'Gece Denetçisi', true),
 ('HOUSEKEEPING_MANAGER', 'Kat Hizmetleri Müdürü', true),
 ('HOUSEKEEPING', 'Kat Görevlisi', true),
 ('ACCOUNTING', 'Muhasebe', true),
 ('CASHIER', 'Kasiyer', true),
 ('SALES', 'Satış', true),
 ('TECHNICAL', 'Teknik Servis', true),
 ('REPORT_ONLY', 'Yalnız Rapor', true);

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT r.code, p.code FROM pms.roles r CROSS JOIN pms.permissions p WHERE r.code IN ('SUPER_ADMIN', 'HOTEL_ADMIN');

INSERT INTO pms.role_permissions (role_code, permission_code)
SELECT 'GENERAL_MANAGER', code FROM pms.permissions
 WHERE code NOT IN ('user.manage', 'device.manage', 'settings.manage', 'backup.manage', 'migration.manage', 'integration.manage', 'printer.manage', 'room.manage');

INSERT INTO pms.role_permissions (role_code, permission_code) SELECT 'FRONT_OFFICE_MANAGER', unnest(ARRAY[
 'dashboard.view','reservation.view','reservation.create','reservation.edit','reservation.cancel','reservation.overbook','rate.override',
 'checkin.execute','checkout.execute','room.change','guest.view','guest.edit','guest.identity.view','guest.blacklist','company.manage',
 'folio.view','folio.post','folio.discount','folio.void','folio.transfer','folio.close','payment.create','payment.refund','cashier.manage','cashier.view_all',
 'housekeeping.view','maintenance.view','maintenance.manage','night_audit.execute','report.view','financial_report.view','kbs.manage','audit.view']);

INSERT INTO pms.role_permissions (role_code, permission_code) SELECT 'RECEPTION', unnest(ARRAY[
 'dashboard.view','reservation.view','reservation.create','reservation.edit','reservation.cancel','checkin.execute','checkout.execute','room.change',
 'guest.view','guest.edit','guest.identity.view','folio.view','folio.post','folio.transfer','payment.create','cashier.manage',
 'housekeeping.view','maintenance.view','report.view','kbs.manage']);

INSERT INTO pms.role_permissions (role_code, permission_code) SELECT 'NIGHT_AUDIT', unnest(ARRAY[
 'dashboard.view','reservation.view','reservation.cancel','checkin.execute','checkout.execute','guest.view','folio.view','folio.post','payment.create',
 'cashier.manage','housekeeping.view','night_audit.execute','report.view','financial_report.view','kbs.manage']);

INSERT INTO pms.role_permissions (role_code, permission_code) SELECT 'HOUSEKEEPING_MANAGER', unnest(ARRAY[
 'dashboard.view','housekeeping.view','housekeeping.update','housekeeping.inspect','housekeeping.assign','maintenance.view','maintenance.manage','report.view']);

INSERT INTO pms.role_permissions (role_code, permission_code) SELECT 'HOUSEKEEPING', unnest(ARRAY['housekeeping.view','housekeeping.update','maintenance.view']);

INSERT INTO pms.role_permissions (role_code, permission_code) SELECT 'ACCOUNTING', unnest(ARRAY[
 'dashboard.view','reservation.view','guest.view','company.manage','folio.view','folio.post','folio.discount','folio.void','folio.transfer','folio.close',
 'payment.create','payment.refund','cashier.manage','cashier.view_all','report.view','financial_report.view','audit.view']);

INSERT INTO pms.role_permissions (role_code, permission_code) SELECT 'CASHIER', unnest(ARRAY[
 'dashboard.view','reservation.view','guest.view','folio.view','folio.post','payment.create','cashier.manage']);

INSERT INTO pms.role_permissions (role_code, permission_code) SELECT 'SALES', unnest(ARRAY[
 'dashboard.view','reservation.view','reservation.create','reservation.edit','guest.view','guest.edit','company.manage','rate.manage','rate.override','report.view']);

INSERT INTO pms.role_permissions (role_code, permission_code) SELECT 'TECHNICAL', unnest(ARRAY['maintenance.view','maintenance.manage','housekeeping.view']);

INSERT INTO pms.role_permissions (role_code, permission_code) SELECT 'REPORT_ONLY', unnest(ARRAY['dashboard.view','report.view','financial_report.view']);

-- Sistem işlem kodu: gece denetiminin oda ücreti postalaması için gereklidir. Fiyat içermez.
INSERT INTO pms.transaction_codes (code, name, category, vat_rate, is_system) VALUES ('ROOM', 'Konaklama', 'room', 0, true);

-- Sistem ödeme tipleri (tutar veya hesap içermez). Otel bunları pasifleştirebilir veya yenilerini ekleyebilir.
INSERT INTO pms.payment_methods (code, name, kind, requires_reference, is_system, sort_order) VALUES
 ('CASH', 'Nakit', 'cash', false, true, 1),
 ('CARD', 'Kredi Kartı', 'credit_card', true, true, 2),
 ('BANK', 'Havale / EFT', 'bank_transfer', true, true, 3),
 ('CITYLEDGER', 'Cari Hesap (City Ledger)', 'city_ledger', false, true, 4),
 ('COMPANY', 'Şirkete Aktarım', 'company', false, true, 5),
 ('AGENCY', 'Acenteye Aktarım', 'agency', false, true, 6);

INSERT INTO pms.integrations (code, enabled) VALUES ('kbs_egm', false), ('kbs_jandarma', false);
