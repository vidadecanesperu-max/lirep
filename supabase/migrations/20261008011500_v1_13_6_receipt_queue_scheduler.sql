-- LIREP V1.13.6: safe queue discovery for scheduled Worker.
-- Discovery does not claim, send or alter a record.
create or replace function public.lirep_next_pending_receipt_id()
returns uuid
language sql
security definer
set search_path=public
as $$
  select q.id
  from public.complaint_delivery_queue q
  join public.organizations o on o.id=q.organization_id
  join public.organization_email_settings s
    on s.organization_id=q.organization_id and s.is_active=true
  where q.status in ('pending','failed')
    and q.next_attempt_at<=now()
    and q.attempt_count<5
    and o.public_prefix='LIREPQA1' -- QA-only rollout; expand after evidence validation
  order by q.created_at,q.id
  limit 1
$$;
revoke all on function public.lirep_next_pending_receipt_id() from public,anon,authenticated;
grant execute on function public.lirep_next_pending_receipt_id() to service_role;

select case when to_regprocedure('public.lirep_next_pending_receipt_id()') is not null
  then 'PASS' else 'FAIL' end as qa_email_scheduler;
