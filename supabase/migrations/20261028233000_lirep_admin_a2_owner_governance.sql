-- LIREP ADMIN A2: owner-only governance. Requires A1.
-- Staged migration: NOT applied to production.
begin;

create table if not exists public.lirep_admin_platform_owners (
 user_id uuid primary key references auth.users(id) on delete cascade,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.lirep_admin_platform_owners enable row level security;
revoke all on public.lirep_admin_platform_owners from public,anon,authenticated;
grant select,insert,update,delete on public.lirep_admin_platform_owners to service_role;

create table if not exists public.lirep_admin_access_audit (
 id bigint generated always as identity primary key,
 actor_user_id uuid not null,
 target_user_id uuid not null,
 organization_id uuid not null references public.organizations(id),
 previous_role text,
 new_role text,
 action text not null check (action in ('grant','update','revoke')),
 occurred_at timestamptz not null default now()
);
create index if not exists lirep_admin_access_audit_time_idx
 on public.lirep_admin_access_audit(occurred_at desc);
alter table public.lirep_admin_access_audit enable row level security;
revoke all on public.lirep_admin_access_audit from public,anon,authenticated;
grant select,insert on public.lirep_admin_access_audit to service_role;

create or replace function public.lirep_admin_is_owner()
returns boolean language sql stable security definer set search_path=''
as $body$
 select exists(
  select 1 from public.lirep_admin_platform_owners x
  where x.user_id=(select auth.uid()) and x.active
 );
$body$;

-- Replace A1 organization discovery: owner sees every active company.
create or replace function public.lirep_admin_my_organizations()
returns jsonb language sql stable security definer set search_path=''
as $body$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',o.id,'name',o.legal_name,'prefix',o.public_prefix,
  'role',case when public.lirep_admin_is_owner() then 'platform_admin' else m.role end
 ) order by o.legal_name),'[]'::jsonb)
 from public.organizations o
 left join public.lirep_admin_memberships m
 on m.organization_id=o.id and m.user_id=(select auth.uid()) and m.active
 where o.active and (public.lirep_admin_is_owner() or m.user_id is not null);
$body$;

-- Replace A1 inbox: owner authorization while preserving tenant check.
create or replace function public.lirep_admin_list_complaints(p_organization_id uuid,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=''
as $body$
declare v_result jsonb;
begin
 if (select auth.uid()) is null then raise exception 'UNAUTHORIZED' using errcode='28000'; end if;
 if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.active)
 then raise exception 'ORGANIZATION_NOT_AVAILABLE' using errcode='42501'; end if;
 if not public.lirep_admin_is_owner() and not exists (
  select 1 from public.lirep_admin_memberships m
  where m.user_id=(select auth.uid()) and m.organization_id=p_organization_id
   and m.active and m.role in ('company_admin','operator','viewer')
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
$body$;

create or replace function public.lirep_admin_owner_memberships(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $body$
declare v_result jsonb;
begin
 if not public.lirep_admin_is_owner() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'user_id',m.user_id,'email',u.email,'role',m.role,'active',m.active
 ) order by u.email),'[]'::jsonb) into v_result
 from public.lirep_admin_memberships m
 join auth.users u on u.id=m.user_id
 where m.organization_id=p_organization_id;
 return v_result;
end;
$body$;

create or replace function public.lirep_admin_owner_set_membership(
 p_organization_id uuid,p_user_email text,p_role text,p_active boolean default true
)
returns jsonb language plpgsql security definer set search_path=''
as $body$
declare v_user_id uuid; v_previous text; v_action text;
begin
 if not public.lirep_admin_is_owner() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.active)
 then raise exception 'ORGANIZATION_NOT_AVAILABLE' using errcode='22023'; end if;
 if p_role not in ('company_admin','operator','viewer') then raise exception 'INVALID_ROLE' using errcode='22023'; end if;
 if nullif(btrim(coalesce(p_user_email,'')),'') is null then raise exception 'EMAIL_REQUIRED' using errcode='22023'; end if;
 select u.id into v_user_id from auth.users u
 where lower(u.email)=lower(btrim(p_user_email)) and u.email_confirmed_at is not null;
 if v_user_id is null then raise exception 'AUTH_USER_NOT_FOUND_OR_NOT_CONFIRMED' using errcode='22023'; end if;
 select m.role into v_previous from public.lirep_admin_memberships m
 where m.user_id=v_user_id and m.organization_id=p_organization_id;
 insert into public.lirep_admin_memberships(user_id,organization_id,role,active)
 values(v_user_id,p_organization_id,p_role,coalesce(p_active,true))
 on conflict(user_id,organization_id) do update
 set role=excluded.role,active=excluded.active;
 v_action:=case when coalesce(p_active,true)=false then 'revoke'
   when v_previous is null then 'grant' else 'update' end;
 insert into public.lirep_admin_access_audit
 (actor_user_id,target_user_id,organization_id,previous_role,new_role,action)
 values ((select auth.uid()),v_user_id,p_organization_id,v_previous,
         case when coalesce(p_active,true) then p_role else null end,v_action);
 return jsonb_build_object('ok',true,'action',v_action);
end;
$body$;

revoke all on function public.lirep_admin_is_owner() from public,anon,authenticated;
revoke all on function public.lirep_admin_my_organizations() from public,anon,authenticated;
revoke all on function public.lirep_admin_list_complaints(uuid,integer) from public,anon,authenticated;
revoke all on function public.lirep_admin_owner_memberships(uuid) from public,anon,authenticated;
revoke all on function public.lirep_admin_owner_set_membership(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.lirep_admin_is_owner() to authenticated;
grant execute on function public.lirep_admin_my_organizations() to authenticated;
grant execute on function public.lirep_admin_list_complaints(uuid,integer) to authenticated;
grant execute on function public.lirep_admin_owner_memberships(uuid) to authenticated;
grant execute on function public.lirep_admin_owner_set_membership(uuid,text,text,boolean) to authenticated;
commit;
