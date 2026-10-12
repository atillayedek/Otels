-- Bireysel faturalama ve eski sistemden aktarılan vergi bilgileri için misafir vergi alanları.
ALTER TABLE pms.guests ADD COLUMN tax_office text;
ALTER TABLE pms.guests ADD COLUMN tax_number text;
CREATE INDEX guests_tax_number_idx ON pms.guests (tax_number) WHERE tax_number IS NOT NULL;
CREATE INDEX companies_tax_number_idx ON pms.companies (tax_number) WHERE tax_number IS NOT NULL;
CREATE INDEX agencies_tax_number_idx ON pms.agencies (tax_number) WHERE tax_number IS NOT NULL;

-- Eski muhasebe programındaki şirket/acente cari hareketlerinin (borç/alacak) aktarımı.
ALTER TABLE pms.import_jobs DROP CONSTRAINT import_jobs_entity_check;
ALTER TABLE pms.import_jobs ADD CONSTRAINT import_jobs_entity_check
    CHECK (entity IN ('guests', 'companies', 'agencies', 'room_types', 'rooms', 'reservations', 'folio_history', 'account_ledger'));

CREATE INDEX folio_lines_migration_idx ON pms.folio_lines (migration_job_id) WHERE migration_job_id IS NOT NULL;
CREATE INDEX folio_lines_migration_source_idx ON pms.folio_lines (migration_source_id) WHERE migration_source_id IS NOT NULL;
