-- LIREP QA-RELEASE-024 · Post-hardening production gate.
-- Read-only. Does not return personal data or receipt access tokens.
with checks as (
select 'QA_THIRD_COMPLAINT_SENT' as control,
  exists(select 1 from public.complaints c join public.complaint_delivery_queue q on q.complaint_id=c.id
    where c.public_code='LIREPQA1-QA001-2026-00000003'
      and q.status='sent' and q.attempt_count=1 and q.provider_message_id is not null and q.sent_at is not null) as passed
union all select 'QA_THIRD_EVIDENCE',
  (select count(*)=1 from public.communication_evidence e join public.complaints c on c.id=e.complaint_id
    where c.public_code='LIREPQA1-QA001-2026-00000003' and e.channel='email' and e.delivery_status='sent')
union all select 'QA_THIRD_RECEIPT_TOKEN',
  (select count(*)>=1 from public.complaint_receipt_tokens t join public.complaints c on c.id=t.complaint_id
    where c.public_code='LIREPQA1-QA001-2026-00000003')
union all select 'PRODUCTION_EMAILS_NOT_SENT',
  (select count(*)=0 from public.complaint_delivery_queue q join public.organizations o on o.id=q.organization_id
    where o.public_prefix='VIDACANE' and q.status='sent')
union all select 'ANON_INTERNAL_RPC_BLOCKED',
  not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='lirep_create_complaint_internal'
      and has_function_privilege('anon',p.oid,'EXECUTE'))
union all select 'AUTH_INTERNAL_RPC_BLOCKED',
  not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='lirep_create_complaint_internal'
      and has_function_privilege('authenticated',p.oid,'EXECUTE'))
union all select 'AUTH_EVIDENCE_INSERT_BLOCKED',
  not has_table_privilege('authenticated','public.communication_evidence','INSERT')
union all select 'AUTH_COMPLAINT_ID_UPDATE_BLOCKED',
  not has_column_privilege('authenticated','public.complaints','id','UPDATE')
)
select control,case when passed then 'PASS' else 'FAIL' end as result
from checks order by control;
