-- LIREP V1.11.6 — CLASIFICACIÓN FORMAL DE REGISTRO DE PRUEBA
-- Conserva correlativo, historial y auditoría. No elimina ni reutiliza numeración.
-- Crea una marca administrativa separada del contenido legal original.

begin;

create table if not exists public.complaint_administrative_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  complaint_id uuid not null references public.complaints(id) on delete restrict,
  flag_type text not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null,
  constraint complaint_administrative_flags_type_chk
    check (flag_type in ('test_record','voided','duplicate','other')),
  constraint complaint_administrative_flags_unique unique (complaint_id, flag_type)
);

alter table public.complaint_administrative_flags enable row level security;
revoke all on public.complaint_administrative_flags from public, anon, authenticated;
grant select, insert on public.complaint_administrative_flags to service_role;

insert into public.complaint_administrative_flags (
  organization_id, complaint_id, flag_type, reason, metadata
)
select
  c.organization_id,
  c.id,
  'test_record',
  'Registro generado accidentalmente durante QA técnico de LIREP. No corresponde a una reclamación real de consumidor. Se conserva íntegro para trazabilidad y no se reutiliza su correlativo.',
  jsonb_build_object(
    'classification','technical_qa',
    'public_code',c.public_code,
    'classified_at',now(),
    'preserve_sequence',true,
    'exclude_from_operational_consumer_cases',true
  )
from public.complaints c
where c.public_code='VIDACANE-LR001-2026-00000001'
on conflict (complaint_id, flag_type) do nothing;

commit;

select
  case when
    exists (
      select 1
      from public.complaint_administrative_flags f
      join public.complaints c on c.id=f.complaint_id
      where c.public_code='VIDACANE-LR001-2026-00000001'
        and f.flag_type='test_record'
    )
    and (
      select b.next_number
      from public.complaint_books b
      join public.organizations o on o.id=b.organization_id
      where o.public_prefix='VIDACANE' and b.code='LR001'
      limit 1
    )=2
  then 'PASS' else 'FAIL' end as v1_11_6_status,
  'VIDACANE-LR001-2026-00000001'::text as preserved_test_record,
  (
    select b.next_number
    from public.complaint_books b
    join public.organizations o on o.id=b.organization_id
    where o.public_prefix='VIDACANE' and b.code='LR001'
    limit 1
  ) as production_lr001_next_number;
