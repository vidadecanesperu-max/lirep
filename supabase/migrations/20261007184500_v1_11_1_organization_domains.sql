-- LIREP V1.11.1 — dominios autorizados multiempresa
-- Ejecutar una sola vez en lirep-prod.

begin;

create table if not exists public.organization_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  hostname text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_domains_hostname_format
    check (
      hostname = lower(hostname)
      and hostname !~ '^[a-z]+://'
      and hostname !~ '[/?#:]'
      and hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
    ),
  unique (organization_id, hostname)
);

alter table public.organization_domains enable row level security;

revoke all on table public.organization_domains from public, anon, authenticated;
grant select on table public.organization_domains to service_role;

create index if not exists organization_domains_active_hostname_idx
  on public.organization_domains (hostname)
  where active = true;

insert into public.organization_domains (organization_id, hostname, active)
select o.id, x.hostname, true
from public.organizations o
cross join lateral (
  values ('vidadecanes.pe'::text), ('www.vidadecanes.pe'::text)
) x(hostname)
where o.ruc = '20609667584'
on conflict (organization_id, hostname)
do update set active = excluded.active, updated_at = now();

create or replace function public.lirep_public_origin_allowed(
  p_public_prefix text,
  p_origin text
) returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_prefix text := upper(btrim(coalesce(p_public_prefix,'')));
  v_origin text := lower(btrim(coalesce(p_origin,'')));
  v_host text;
begin
  if v_prefix !~ '^[A-Z0-9]{8}$' then return false; end if;
  if v_origin !~ '^https://[a-z0-9.-]+(?::[0-9]+)?$' then return false; end if;

  v_host := regexp_replace(v_origin, '^https://', '');
  v_host := regexp_replace(v_host, ':[0-9]+$', '');

  return exists (
    select 1
    from public.organizations o
    join public.organization_domains d
      on d.organization_id = o.id
     and d.active = true
    where o.public_prefix = v_prefix
      and o.active = true
      and d.hostname = v_host
  );
end;
$$;

revoke all on function public.lirep_public_origin_allowed(text,text)
  from public, anon, authenticated;
grant execute on function public.lirep_public_origin_allowed(text,text)
  to service_role;

commit;

-- QA estructural, no crea reclamos.
select
  case
    when to_regclass('public.organization_domains') is not null
     and exists (
       select 1 from public.organization_domains d
       join public.organizations o on o.id=d.organization_id
       where o.ruc='20609667584' and d.hostname='vidadecanes.pe' and d.active
     )
     and exists (
       select 1 from public.organization_domains d
       join public.organizations o on o.id=d.organization_id
       where o.ruc='20609667584' and d.hostname='www.vidadecanes.pe' and d.active
     )
     and public.lirep_public_origin_allowed('VIDACANE','https://vidadecanes.pe')
     and public.lirep_public_origin_allowed('VIDACANE','https://www.vidadecanes.pe')
     and not public.lirep_public_origin_allowed('VIDACANE','https://example.com')
    then 'PASS' else 'FAIL'
  end as v1_11_1_status;
