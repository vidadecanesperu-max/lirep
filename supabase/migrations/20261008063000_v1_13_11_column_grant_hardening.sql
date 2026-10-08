-- LIREP V1.13.11: least-privilege column grants for authenticated.
-- Keep only narrowly scoped organization profile edits and case workflow fields.
-- SECURITY DEFINER RPCs continue to operate with their owner's privileges.
begin;
revoke update on public.complaints from authenticated;
grant update (status,provider_actions,responded_at,closed_at,consumer_conformity,consumer_conformity_at)
  on public.complaints to authenticated;
revoke update on public.organizations from authenticated;
grant update (legal_name,trade_name,ruc,email,phone,website,address)
  on public.organizations to authenticated;
revoke insert on public.communication_evidence from authenticated;
-- Evidence is written by the service-role receipt pipeline. Do not grant
-- arbitrary authenticated users the ability to assert an email was delivered.
commit;

select 'complaints' as object_name,
       has_column_privilege('authenticated','public.complaints','id','UPDATE') as id_write,
       has_column_privilege('authenticated','public.complaints','status','UPDATE') as workflow_write
union all
select 'organizations',
       has_column_privilege('authenticated','public.organizations','id','UPDATE'),
       has_column_privilege('authenticated','public.organizations','legal_name','UPDATE')
union all
select 'communication_evidence',
       has_column_privilege('authenticated','public.communication_evidence','delivery_status','INSERT'),
       has_table_privilege('service_role','public.communication_evidence','INSERT');
