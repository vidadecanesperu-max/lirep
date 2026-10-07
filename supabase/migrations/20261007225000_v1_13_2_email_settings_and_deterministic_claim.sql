-- LIREP V1.13.2 · deterministic email delivery + per-organization sender configuration

create table if not exists public.organization_email_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null default 'resend' check (provider in ('resend')),
  from_name text not null,
  from_email text not null,
  reply_to text,
  internal_notification_emails text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_email_settings_from_email_chk check (position('@' in from_email) > 1)
);

alter table public.organization_email_settings enable row level security;
revoke all on public.organization_email_settings from public, anon, authenticated;
grant select on public.organization_email_settings to service_role;

insert into public.organization_email_settings(
  organization_id,provider,from_name,from_email,reply_to,is_active
)
select id,'resend','LIREP - Vida de Canes','lirep@mail.vidadecanes.pe',null,true
from public.organizations
where public_prefix='VIDACANE'
on conflict (organization_id) do update
set provider=excluded.provider,
    from_name=excluded.from_name,
    from_email=excluded.from_email,
    is_active=true,
    updated_at=now();

-- QA uses the verified central sender only for controlled tests.
insert into public.organization_email_settings(
  organization_id,provider,from_name,from_email,reply_to,is_active
)
select id,'resend','LIREP QA','lirep@mail.vidadecanes.pe',null,true
from public.organizations
where public_prefix='LIREPQA1'
on conflict (organization_id) do update
set provider=excluded.provider,
    from_name=excluded.from_name,
    from_email=excluded.from_email,
    is_active=true,
    updated_at=now();

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
  set status='processing',
      locked_at=now(),
      attempt_count=attempt_count+1,
      updated_at=now()
  where id=v_q.id;

  select o.public_prefix,c.public_code,
         s.from_name,s.from_email,s.reply_to,
         public.lirep_public_receipt_data(o.public_prefix,c.public_code)
  into v_prefix,v_code,v_from_name,v_from_email,v_reply_to,v_data
  from public.complaints c
  join public.organizations o on o.id=c.organization_id
  join public.organization_email_settings s
    on s.organization_id=o.id and s.is_active=true
  where c.id=v_q.complaint_id;

  if v_data is null or v_from_email is null then
    update public.complaint_delivery_queue
    set status='failed',
        last_error='EMAIL_CONFIGURATION_NOT_AVAILABLE',
        next_attempt_at=now()+interval '15 minutes',
        locked_at=null,
        updated_at=now()
    where id=v_q.id;
    return null;
  end if;

  return jsonb_build_object(
    'queue_id',v_q.id,
    'recipient',v_q.recipient,
    'public_prefix',v_prefix,
    'public_code',v_code,
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

select
  case when count(*)=2 then 'PASS' else 'FAIL' end as result,
  count(*) as configured_tenants
from public.organization_email_settings s
join public.organizations o on o.id=s.organization_id
where o.public_prefix in ('VIDACANE','LIREPQA1')
  and s.is_active=true
  and s.from_email='lirep@mail.vidadecanes.pe';
