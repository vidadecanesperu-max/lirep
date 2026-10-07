-- LIREP V1.13.0 · Email delivery queue + evidence
-- Multiempresa, provider-agnostic and idempotent.

create table if not exists public.complaint_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  complaint_id uuid not null references public.complaints(id),
  channel text not null default 'email' check (channel in ('email')),
  recipient text not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider text,
  provider_message_id text,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (complaint_id, channel)
);

create index if not exists complaint_delivery_queue_pending_idx
  on public.complaint_delivery_queue(status, next_attempt_at)
  where status in ('pending','failed');

alter table public.complaint_delivery_queue enable row level security;
revoke all on public.complaint_delivery_queue from public, anon, authenticated;
grant select, insert, update on public.complaint_delivery_queue to service_role;

create or replace function public.lirep_queue_receipt_email(
  p_public_prefix text,
  p_public_code text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid;
  v_complaint uuid;
  v_email text;
  v_queue uuid;
begin
  select o.id,c.id,co.email
    into v_org,v_complaint,v_email
  from public.complaints c
  join public.organizations o on o.id=c.organization_id
  join public.consumers co on co.id=c.consumer_id
  where o.public_prefix=p_public_prefix
    and c.public_code=p_public_code
  limit 1;

  if v_complaint is null then raise exception 'COMPLAINT_NOT_FOUND'; end if;
  if v_email is null or btrim(v_email)='' then
    return jsonb_build_object('queued',false,'reason','EMAIL_NOT_AVAILABLE');
  end if;

  insert into public.complaint_delivery_queue(organization_id,complaint_id,recipient)
  values(v_org,v_complaint,lower(btrim(v_email)))
  on conflict (complaint_id,channel) do update
    set recipient=excluded.recipient,
        updated_at=now()
  returning id into v_queue;

  return jsonb_build_object('queued',true,'queue_id',v_queue);
end;
$$;

revoke all on function public.lirep_queue_receipt_email(text,text) from public,anon,authenticated;
grant execute on function public.lirep_queue_receipt_email(text,text) to service_role;

create or replace function public.lirep_claim_receipt_email()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_q public.complaint_delivery_queue%rowtype;
  v_data jsonb;
begin
  select * into v_q
  from public.complaint_delivery_queue
  where status in ('pending','failed')
    and next_attempt_at <= now()
    and attempt_count < 5
  order by created_at
  for update skip locked
  limit 1;

  if v_q.id is null then return null; end if;

  update public.complaint_delivery_queue
  set status='processing', locked_at=now(), attempt_count=attempt_count+1, updated_at=now()
  where id=v_q.id;

  select public.lirep_public_receipt_data(o.public_prefix,c.public_code)
    into v_data
  from public.complaints c
  join public.organizations o on o.id=c.organization_id
  where c.id=v_q.complaint_id;

  return jsonb_build_object(
    'queue_id',v_q.id,
    'recipient',v_q.recipient,
    'receipt',v_data
  );
end;
$$;

revoke all on function public.lirep_claim_receipt_email() from public,anon,authenticated;
grant execute on function public.lirep_claim_receipt_email() to service_role;

create or replace function public.lirep_complete_receipt_email(
  p_queue_id uuid,
  p_success boolean,
  p_provider text default null,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_complaint uuid;
begin
  update public.complaint_delivery_queue
  set status=case when p_success then 'sent' else 'failed' end,
      provider=p_provider,
      provider_message_id=p_provider_message_id,
      last_error=case when p_success then null else left(coalesce(p_error,'UNKNOWN_ERROR'),1000) end,
      sent_at=case when p_success then now() else sent_at end,
      next_attempt_at=case when p_success then next_attempt_at else now()+interval '15 minutes' end,
      locked_at=null,
      updated_at=now()
  where id=p_queue_id
  returning complaint_id into v_complaint;

  if v_complaint is null then raise exception 'QUEUE_ITEM_NOT_FOUND'; end if;

  if p_success then
    update public.complaints set receipt_sent_at=coalesce(receipt_sent_at,now()) where id=v_complaint;

    insert into public.communication_evidence(organization_id,complaint_id,channel,recipient,provider_reference,sent_at)
    select organization_id,complaint_id,'email',recipient,p_provider_message_id,now()
    from public.complaint_delivery_queue where id=p_queue_id;
  end if;
end;
$$;

revoke all on function public.lirep_complete_receipt_email(uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.lirep_complete_receipt_email(uuid,boolean,text,text,text) to service_role;
