-- LIREP QA-SECURITY-020 · Before changing column grants.
-- Read-only: identify function dependencies and authenticated grants.
select 'GRANT' as category,c.relname as object_name,
       a.attname as detail,
       has_column_privilege('authenticated',c.oid,a.attname,'UPDATE') as can_update,
       has_column_privilege('authenticated',c.oid,a.attname,'INSERT') as can_insert
from pg_class c join pg_namespace n on n.oid=c.relnamespace
join pg_attribute a on a.attrelid=c.oid
where n.nspname='public'
 and c.relname in ('complaints','organizations','communication_evidence')
 and a.attnum>0 and not a.attisdropped
 and (a.attname in ('id','organization_id','consumer_id','public_code','submitted_at','receipt_sent_at','status','legal_name','public_prefix','external_message_id','delivery_status','complaint_id'))
order by object_name,detail;
