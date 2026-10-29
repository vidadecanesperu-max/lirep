-- LIREP ADMIN A1: isolated, read-only per-tenant management API.
-- Do not deploy until reviewed in the correct LIREP Supabase project.
begin;
create table if not exists public.lirep_admin_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('company_admin','operator','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id,organization_id)
);
create index if not exists lirep_admin_memberships_organization_idx
  on public.lirep_admin_memberships(organization_id,active);
alter table public.lirep_admin_memberships enable row level security;
revoke all on public.lirep_admin_memberships from public,anon,authenticated;
grant select,insert,update,delete on public.lirep_admin_memberships to service_role;

-- SECURITY DEFINER is necessary because existing complaint tables do not expose
-- direct SELECT privileges to authenticated users. Every result is bound to auth.uid().
create or replace function public.lirep_admin_my_organizations()
returns jsonb language sql stable security definer set search_path = ''
as $fn$
select coalesce(jsonb_agg(jsonb_build_object(
 'id',o.id,'name',o.legal_name,'prefix',o.public_prefix,'role',m.role
) order by o.legal_name),'[]'::jsonb)
from public.lirep_admin_memberships m
join public.organizations o on o.id=m.organization_id
where m.user_id=(select auth.uid()) and m.active and o.active;
$fn$;

create or replace function public.lirep_admin_list_complaints(p_organization_id uuid,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = ''
as $fn$
declare v_result jsonb;
begin
 if (select auth.uid()) is null then raise exception 'UNAUTHORIZED' using errcode='28000'; end if;
 if not exists (
   select 1 from public.lirep_admin_memberships m
   join public.organizations o on o.id=m.organization_id
   where m.user_id=(select auth.uid()) and m.organization_id=p_organization_id
    and m.active and o.active and m.role in ('company_admin','operator','viewer')
 ) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.submitted_at desc),'[]'::jsonb) into v_result
 from (
  select c.id,c.public_code,c.complaint_type::text as complaint_type,
   c.status::text as status,c.submitted_at,c.response_due_at,
   e.name as establishment
  from public.complaints c
  left join public.establishments e on e.id=c.establishment_id and e.organization_id=c.organization_id
  where c.organization_id=p_organization_id
  order by c.submitted_at desc,c.id desc
  limit least(greatest(coalesce(p_limit,50),1),100)
 ) t;
 return v_result;
end;
$fn$;

revoke all on function public.lirep_admin_my_organizations() from public,anon,authenticated;
revoke all on function public.lirep_admin_list_complaints(uuid,integer) from public,anon,authenticated;
grant execute on function public.lirep_admin_my_organizations() to authenticated,service_role;
grant execute on function public.lirep_admin_list_complaints(uuid,integer) to authenticated,service_role;
commit;
