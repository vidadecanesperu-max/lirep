-- LIREP QA-SECURITY-022 · Post-hardening read-only regression.
-- One result table; does not reveal consumer information or access tokens.
with checks as (
 select 'QA_EMAILS_SENT' as control,
        (select count(*)=2 from public.complaint_delivery_queue q
         join public.organizations o on o.id=q.organization_id
         where o.public_prefix='LIREPQA1' and q.status='sent') as passed
 union all
 select 'QA_EMAIL_EVIDENCE',
        (select count(*)=2 from public.communication_evidence e
         join public.organizations o on o.id=e.organization_id
         where o.public_prefix='LIREPQA1' and e.channel='email' and e.delivery_status='sent')
 union all
 select 'PRODUCTION_NO_EMAILS',
        (select count(*)=0 from public.complaint_delivery_queue q
         join public.organizations o on o.id=q.organization_id
         where o.public_prefix='VIDACANE' and q.status='sent')
 union all
 select 'COMPLAINT_ID_IMMUTABLE_GRANT',
        not has_column_privilege('authenticated','public.complaints','id','UPDATE')
 union all
 select 'COMPLAINT_SUBMISSION_DATE_IMMUTABLE_GRANT',
        not has_column_privilege('authenticated','public.complaints','submitted_at','UPDATE')
 union all
 select 'ORGANIZATION_ID_IMMUTABLE_GRANT',
        not has_column_privilege('authenticated','public.organizations','id','UPDATE')
 union all
 select 'AUTHENTICATED_CANNOT_FORGE_EVIDENCE',
        not has_table_privilege('authenticated','public.communication_evidence','INSERT')
 union all
 select 'SERVICE_CAN_COMPLETE_EMAIL',
        has_function_privilege('service_role','public.lirep_complete_receipt_email(uuid,boolean,text,text,text)','EXECUTE')
 union all
 select 'ANON_CANNOT_COMPLETE_EMAIL',
        not has_function_privilege('anon','public.lirep_complete_receipt_email(uuid,boolean,text,text,text)','EXECUTE')
)
select control,case when passed then 'PASS' else 'FAIL' end as result
from checks order by control;
