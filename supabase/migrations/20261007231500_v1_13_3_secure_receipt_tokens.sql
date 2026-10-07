-- LIREP V1.13.3 · Secure receipt access tokens
create table if not exists public.complaint_receipt_tokens (
  complaint_id uuid primary key references public.complaints(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  access_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists complaint_receipt_tokens_org_idx on public.complaint_receipt_tokens(organization_id);
alter table public.complaint_receipt_tokens enable row level security;
revoke all on public.complaint_receipt_tokens from public,anon,authenticated;
grant select,insert,update on public.complaint_receipt_tokens to service_role;

create or replace function public.lirep_issue_receipt_token(p_public_prefix text,p_public_code text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_complaint uuid; v_org uuid; v_token uuid;
begin
  select c.id,o.id into v_complaint,v_org
  from public.complaints c join public.organizations o on o.id=c.organization_id
  where o.public_prefix=upper(btrim(p_public_prefix)) and c.public_code=upper(btrim(p_public_code)) limit 1;
  if v_complaint is null then raise exception 'COMPLAINT_NOT_FOUND'; end if;
  insert into public.complaint_receipt_tokens(complaint_id,organization_id)
  values(v_complaint,v_org)
  on conflict(complaint_id) do update set organization_id=excluded.organization_id
  returning access_token into v_token;
  return v_token;
end $$;
revoke all on function public.lirep_issue_receipt_token(text,text) from public,anon,authenticated;
grant execute on function public.lirep_issue_receipt_token(text,text) to service_role;

create or replace function public.lirep_secure_receipt_data(p_public_prefix text,p_public_code text,p_access_token uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_ok boolean;
begin
  select true into v_ok
  from public.complaints c
  join public.organizations o on o.id=c.organization_id
  join public.complaint_receipt_tokens t on t.complaint_id=c.id and t.organization_id=o.id
  where o.public_prefix=upper(btrim(p_public_prefix))
    and c.public_code=upper(btrim(p_public_code))
    and t.access_token=p_access_token and t.revoked_at is null limit 1;
  if coalesce(v_ok,false) is not true then return null; end if;
  return public.lirep_public_receipt_data(upper(btrim(p_public_prefix)),upper(btrim(p_public_code)));
end $$;
revoke all on function public.lirep_secure_receipt_data(text,text,uuid) from public,anon,authenticated;
grant execute on function public.lirep_secure_receipt_data(text,text,uuid) to service_role;

-- Disable direct service-role use of the old public receipt function from application paths after secure wrapper exists.
-- It remains callable only by DB owner/internal functions until later dependency cleanup.
revoke execute on function public.lirep_public_receipt_data(text,text) from service_role;

select case when to_regclass('public.complaint_receipt_tokens') is not null then 'PASS' else 'FAIL' end as result;
