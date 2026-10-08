-- LIREP V1.13.10 · Restrict direct execution of privileged trigger functions.
-- PostgreSQL trigger execution is independent of the calling user's EXECUTE
-- privilege on the trigger function. This migration does not disable triggers.
begin;
revoke execute on function public.lirep_log_complaint_status() from public, anon, authenticated;
revoke execute on function public.lirep_set_response_due_at() from public, anon, authenticated;
-- Preserve service-role use and internal maintenance.
grant execute on function public.lirep_log_complaint_status() to service_role;
grant execute on function public.lirep_set_response_due_at() to service_role;
commit;

select p.proname as trigger_function,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_can_execute,
       (select count(*) from pg_trigger t where t.tgfoid=p.oid and not t.tgisinternal) as installed_triggers
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('lirep_log_complaint_status','lirep_set_response_due_at')
order by p.proname;
