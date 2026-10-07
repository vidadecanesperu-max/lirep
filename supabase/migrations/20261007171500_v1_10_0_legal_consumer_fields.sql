-- LIREP V1.10.0 — Adecuación legal de datos del consumidor y constancia
-- Aditiva e idempotente. No elimina ni reescribe registros históricos.

begin;

alter table public.consumers
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists is_minor boolean not null default false,
  add column if not exists representative_first_names text,
  add column if not exists representative_last_names text,
  add column if not exists representative_document_type public.lirep_consumer_document_type,
  add column if not exists representative_document_number text,
  add column if not exists representative_phone text,
  add column if not exists representative_email text;

alter table public.complaints
  add column if not exists consumer_conformity boolean not null default false,
  add column if not exists consumer_conformity_at timestamptz,
  add column if not exists preferred_response_channel text,
  add column if not exists receipt_sent_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'consumers_minor_representative_required'
      and conrelid = 'public.consumers'::regclass
  ) then
    alter table public.consumers
      add constraint consumers_minor_representative_required
      check (
        not is_minor
        or (
          nullif(btrim(representative_first_names), '') is not null
          and nullif(btrim(representative_last_names), '') is not null
          and representative_document_type is not null
          and nullif(btrim(representative_document_number), '') is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'complaints_preferred_response_channel_check'
      and conrelid = 'public.complaints'::regclass
  ) then
    alter table public.complaints
      add constraint complaints_preferred_response_channel_check
      check (
        preferred_response_channel is null
        or preferred_response_channel in ('email','phone','physical')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'complaints_conformity_timestamp_check'
      and conrelid = 'public.complaints'::regclass
  ) then
    alter table public.complaints
      add constraint complaints_conformity_timestamp_check
      check (
        (consumer_conformity = false and consumer_conformity_at is null)
        or consumer_conformity = true
      );
  end if;
end $$;

create index if not exists idx_consumers_minor
  on public.consumers (organization_id, is_minor)
  where is_minor = true;

commit;
