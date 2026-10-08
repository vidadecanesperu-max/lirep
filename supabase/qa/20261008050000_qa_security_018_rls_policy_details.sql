-- LIREP QA-SECURITY-018 · Inspect RLS USING/WITH CHECK clauses.
-- Read only. No personal data is queried.
select tablename,policyname,cmd,roles::text as roles,
       coalesce(qual,'<none>') as using_expression,
       coalesce(with_check,'<none>') as with_check_expression
from pg_policies
where schemaname='public'
  and tablename in ('communication_evidence','complaints','organizations')
order by tablename,policyname;
