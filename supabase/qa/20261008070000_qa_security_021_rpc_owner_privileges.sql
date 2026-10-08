-- LIREP QA-SECURITY-021 · Effective RPC owner access after V1.13.11.
-- Read only. Reports role names, not personal information.
with f as (
  select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef,pg_get_userbyid(p.proowner) as owner_name
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (
      'lirep_complete_receipt_email',
      'lirep_queue_receipt_email',
      'lirep_claim_receipt_email_by_id',
      'lirep_submit_public_complaint_gateway',
      'lirep_create_complaint_internal'
    )
)
select f.proname as function_name,
       left(f.args,90) as signature_start,
       f.prosecdef as security_definer,
       f.owner_name,
       has_function_privilege('service_role',f.oid,'EXECUTE') as service_role_can_execute,
       has_function_privilege('anon',f.oid,'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated',f.oid,'EXECUTE') as authenticated_can_execute,
       has_table_privilege(f.owner_name,'public.complaints','INSERT') as owner_can_insert_complaints,
       has_table_privilege(f.owner_name,'public.communication_evidence','INSERT') as owner_can_insert_evidence,
       has_table_privilege(f.owner_name,'public.complaint_delivery_queue','UPDATE') as owner_can_update_queue
from f order by f.proname, f.args;
