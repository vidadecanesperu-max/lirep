-- LIREP V1.11.3 — QA E2E PRECHECK + SELLO DE AISLAMIENTO
-- No crea reclamos ni incrementa correlativos.

with qa as (
  select o.id org_id, e.id establishment_id, b.id book_id, b.next_number
  from public.organizations o
  join public.establishments e on e.organization_id=o.id and e.code='QA-001'
  join public.complaint_books b on b.organization_id=o.id and b.establishment_id=e.id and b.code='QA001'
  where o.public_prefix='LIREPQA1' and o.active and e.active and b.active
),
prod as (
  select b.next_number
  from public.organizations o
  join public.complaint_books b on b.organization_id=o.id
  where o.public_prefix='VIDACANE' and b.code='LR001'
  limit 1
)
select
  case when
    (select count(*) from qa)=1
    and public.lirep_public_origin_allowed('LIREPQA1','https://lirep-public-api.vidadecanes-peru.workers.dev')
    and exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='lirep_submit_public_complaint_gateway'
    )
  then 'PASS' else 'FAIL' end as v1_11_3_precheck,
  (select next_number from qa) as qa_next_number,
  (select next_number from prod) as production_lr001_next_number,
  'LIREPQA1'::text as qa_public_prefix,
  'QA-001'::text as qa_establishment_code,
  'QA001'::text as qa_book_code;
