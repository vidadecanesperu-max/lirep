-- LIREP V1.13.9: close legacy internal RPC exposure.
-- REVOKE only: no complaints, policies or service-role grants changed.
-- Explicitly retain execution for service_role, needed by the public Worker gateway.
begin;
do $$
declare f record;
begin
  for f in
    select p.oid, p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='lirep_create_complaint_internal'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;
commit;

-- Verification: all overloads must be inaccessible to anon and authenticated.
select p.oid::regprocedure::text as function_signature,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='lirep_create_complaint_internal'
order by 1;
