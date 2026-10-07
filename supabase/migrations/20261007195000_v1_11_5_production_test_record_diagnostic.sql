-- LIREP V1.11.5 — DIAGNÓSTICO SEGURO DEL REGISTRO PRODUCTIVO DE PRUEBA
-- SOLO LECTURA. NO borra, no anula, no cambia correlativos.

with target as (
  select
    c.id,
    c.organization_id,
    c.complaint_book_id,
    c.public_code,
    c.sequence_number,
    c.status,
    c.submitted_at,
    c.response_due_at,
    c.created_at
  from public.complaints c
  where c.public_code = 'VIDACANE-LR001-2026-00000001'
),
book as (
  select b.id, b.code, b.next_number, b.organization_id
  from public.complaint_books b
  join public.organizations o on o.id=b.organization_id
  where o.public_prefix='VIDACANE' and b.code='LR001'
  limit 1
)
select
  case
    when (select count(*) from target)=1
     and (select next_number from book)=2
    then 'PASS'
    else 'REVIEW'
  end as v1_11_5_diagnostic,
  (select public_code from target) as target_public_code,
  (select status::text from target) as target_status,
  (select submitted_at from target) as submitted_at,
  (select response_due_at from target) as response_due_at,
  (select next_number from book) as production_lr001_next_number,
  (select count(*) from public.complaint_status_history h join target t on t.id=h.complaint_id) as history_rows,
  (select count(*) from public.audit_log a join target t on t.id=a.record_id) as audit_rows;
