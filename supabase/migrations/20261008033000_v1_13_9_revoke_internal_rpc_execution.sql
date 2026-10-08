-- LIREP V1.13.9: remove PUBLIC/anon/authenticated EXECUTE from internal RPC overloads.
-- Service-role Worker gateway and authorized public form configuration are preserved.
-- No data mutation. Transactional, idempotent.
begin;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature, p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'lirep_create_complaint_internal',
        'lirep_submit_public_complaint_gateway',
        'lirep_submit_public_complaint_server',
        'lirep_next_book_number',
        'lirep_claim_receipt_email',
        'lirep_claim_receipt_email_by_id',
        'lirep_complete_receipt_email',
        'lirep_queue_receipt_email',
        'lirep_next_pending_receipt_id',
        'lirep_issue_receipt_token',
        'lirep_secure_receipt_data',
        'lirep_public_receipt_data',
        'lirep_public_origin_allowed',
        'lirep_authorized_complaint_org',
        'lirep_change_complaint_status',
        'lirep_close_complaint',
        'lirep_respond_complaint',
        'lirep_set_organization_public_prefix'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;
commit;

-- Verify only: each listed internal overload must show anon=false and authenticated=false.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'lirep_create_complaint_internal',
    'lirep_submit_public_complaint_gateway',
    'lirep_submit_public_complaint_server',
    'lirep_next_book_number',
    'lirep_claim_receipt_email',
    'lirep_claim_receipt_email_by_id',
    'lirep_complete_receipt_email',
    'lirep_queue_receipt_email',
    'lirep_next_pending_receipt_id',
    'lirep_issue_receipt_token',
    'lirep_secure_receipt_data',
    'lirep_public_receipt_data',
    'lirep_public_origin_allowed',
    'lirep_authorized_complaint_org',
    'lirep_change_complaint_status',
    'lirep_close_complaint',
    'lirep_respond_complaint',
    'lirep_set_organization_public_prefix'
  )
order by p.proname,arguments;
