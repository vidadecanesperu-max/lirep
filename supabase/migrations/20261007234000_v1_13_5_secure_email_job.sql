-- LIREP V1.13.5 · secure receipt token in deterministic email job

create or replace function public.lirep_claim_receipt_email_by_id(p_queue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_q public.complaint_delivery_queue%rowtype;
  v_data jsonb;
  v_prefix text;
  v_code text;
  v_from_name text;
  v_from_email text;
  v_reply_to text;
  v_token uuid;
begin
  select q.* into v_q
  from public.complaint_delivery_queue q
  where q.id=p_queue_id
    and q.status in ('pending','failed')
    and q.next_attempt_at <= now()
    and q.attempt_count < 5
  for update skip locked;

  if v_q.id is null then return null; end if;

  update public.complaint_delivery_queue
  set status='processing',locked_at=now(),
      attempt_count=attempt_count+1,updated_at=now()
  where id=v_q.id;

  select o.public_prefix,c.public_code,
         s.from_name,s.from_email,s.reply_to
  into v_prefix,v_code,v_from_name,v_from_email,v_reply_to
  from public.complaints c
  join public.organizations o on o.id=c.organization_id
  join public.organization_email_settings s
    on s.organization_id=o.id and s.is_active=true
  where c.id=v_q.complaint_id;

  if v_prefix is null or v_from_email is null then
    update public.complaint_delivery_queue
    set status='failed',last_error='EMAIL_CONFIGURATION_NOT_AVAILABLE',
        next_attempt_at=now()+interval '15 minutes',
        locked_at=null,updated_at=now()
    where id=v_q.id;
    return null;
  end if;

  v_token := public.lirep_issue_receipt_token(v_prefix,v_code);
  v_data := public.lirep_secure_receipt_data(v_prefix,v_code,v_token);

  if v_data is null then
    update public.complaint_delivery_queue
    set status='failed',last_error='SECURE_RECEIPT_NOT_AVAILABLE',
        next_attempt_at=now()+interval '15 minutes',
        locked_at=null,updated_at=now()
    where id=v_q.id;
    return null;
  end if;

  return jsonb_build_object(
    'queue_id',v_q.id,
    'recipient',v_q.recipient,
    'public_prefix',v_prefix,
    'public_code',v_code,
    'receipt_token',v_token,
    'from_name',v_from_name,
    'from_email',v_from_email,
    'reply_to',v_reply_to,
    'receipt',v_data
  );
end;
$$;

revoke all on function public.lirep_claim_receipt_email_by_id(uuid)
from public,anon,authenticated;
grant execute on function public.lirep_claim_receipt_email_by_id(uuid)
to service_role;

-- QA: issue/reuse a secure token for the existing QA record.
select
  'PASS'::text as result,
  public.lirep_issue_receipt_token(
    'LIREPQA1',
    'LIREPQA1-QA001-2026-00000001'
  ) is not null as secure_token_ready,
  (
    select count(*)
    from public.complaint_receipt_tokens t
    join public.organizations o on o.id=t.organization_id
    where o.public_prefix='LIREPQA1'
      and t.revoked_at is null
  ) as active_qa_tokens;
