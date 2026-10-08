-- LIREP QA-SECURITY-017: privileged RPC and RLS policy review.
-- READ ONLY. No consumer data, credentials or receipt tokens returned.
with privileged_functions as (
 select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args,
        p.prosecdef as security_definer,
        has_function_privilege('anon',p.oid,'EXECUTE') as anon_exec,
        has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_exec,
        has_function_privilege('service_role',p.oid,'EXECUTE') as service_exec
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'lirep_%'
)
select 'FUNCTION' as category, proname as object_name,
       left(args,100) as detail,
       case when security_definer then 'DEFINER' else 'INVOKER' end as mode,
       anon_exec,authenticated_exec,service_exec,
       case when security_definer and anon_exec then 'REVIEW_ANON_DEFINER'
            when security_definer and authenticated_exec then 'REVIEW_AUTH_DEFINER'
            else 'OK_ACCESS_SCOPE' end as review
from privileged_functions
union all
select 'POLICY',tablename,policyname,cmd,
       ('anon'=any(roles)) as anon_exec,
       ('authenticated'=any(roles)) as authenticated_exec,
       false as service_exec,
       case when tablename='communication_evidence' and cmd='INSERT' then 'REVIEW_INSERT_WITH_CHECK'
            when tablename='complaints' and cmd='UPDATE' then 'REVIEW_UPDATE_WITH_CHECK'
            else 'REVIEW_TENANT_PREDICATE' end
from pg_policies
where schemaname='public' and tablename in ('complaints','communication_evidence','organizations')
order by category,object_name,detail;
