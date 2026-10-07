-- LIREP V1.11.5 R3 — DIAGNÓSTICO FINAL DEL REGISTRO PRODUCTIVO DE PRUEBA
-- SOLO LECTURA. No borra, no anula y no modifica correlativos.
-- Busca trazabilidad en audit_log sin depender del nombre de su FK.

with target as (
  select
    c.id,
    c.public_code,
    c.status,
    c.submitted_at,
    c.response_due_at
  from public.complaints c
  where c.public_code='VIDACANE-LR001-2026-00000001'
),
book as (
  select b.next_number
  from public.complaint_books b
  join public.organizations o on o.id=b.organization_id
  where o.public_prefix='VIDACANE' and b.code='LR001'
  limit 1
),
audit_matches as (
  select count(*)::bigint as rows_found
  from public.audit_log a
  join target t
    on to_jsonb(a)::text like '%' || t.id::text || '%'
)
select
  case
    when (select count(*) from target)=1
     and (select next_number from book)=2
     and (select rows_found from audit_matches)>=1
    then 'PASS'
    else 'REVIEW'
  end as v1_11_5_r3,
  (select public_code from target) as target_public_code,
  (select status::text from target) as target_status,
  (select submitted_at from target) as submitted_at,
  (select response_due_at from target) as response_due_at,
  (select next_number from book) as production_lr001_next_number,
  (select count(*) from public.complaint_status_history h join target t on t.id=h.complaint_id) as history_rows,
  (select rows_found from audit_matches) as audit_rows;
