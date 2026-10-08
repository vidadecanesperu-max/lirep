-- LIREP QA-SECURITY-019: inspect column-level UPDATE privileges and guards.
-- Read-only, returns schema metadata only.
with target as (
 select c.oid, n.nspname, c.relname
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('complaints','organizations','communication_evidence')
)
select t.relname as table_name,a.attname as column_name,
       has_column_privilege('authenticated',t.oid,a.attname,'UPDATE') as authenticated_can_update,
       has_column_privilege('authenticated',t.oid,a.attname,'INSERT') as authenticated_can_insert
from target t join pg_attribute a on a.attrelid=t.oid
where a.attnum>0 and not a.attisdropped
order by t.relname,a.attnum;

-- Trigger inventory; execute separately if SQL editor shows only final SELECT.
select c.relname as table_name,t.tgname as trigger_name,
       pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('complaints','organizations','communication_evidence')
  and not t.tgisinternal
order by c.relname,t.tgname;
