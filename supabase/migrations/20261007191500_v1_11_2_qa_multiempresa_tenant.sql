-- LIREP V1.11.2 — QA multiempresa aislado
-- Crea un tenant QA separado. No modifica ni consume LR001 de Vida de Canes.

begin;

do $$
declare
  v_org public.organizations%rowtype;
  v_est public.establishments%rowtype;
  v_legal public.legal_versions%rowtype;
begin
  select * into v_legal
  from public.legal_versions
  where active = true
  order by effective_from desc nulls last, created_at desc
  limit 1;

  if v_legal.id is null then
    raise exception 'ACTIVE_LEGAL_VERSION_REQUIRED';
  end if;

  if not exists (select 1 from public.organizations where public_prefix='LIREPQA1') then
    insert into public.organizations (
      legal_name, ruc, trade_name, public_prefix, active
    ) values (
      'LIREP QA MULTIEMPRESA',
      '20999999991',
      'LIREP QA',
      'LIREPQA1',
      true
    );
  end if;

  select * into v_org from public.organizations where public_prefix='LIREPQA1';

  if not exists (
    select 1 from public.establishments
    where organization_id=v_org.id and code='QA-001'
  ) then
    insert into public.establishments (
      organization_id, code, name, address, district, province, department, is_virtual, active
    ) values (
      v_org.id, 'QA-001', 'LIREP QA - Establecimiento virtual',
      'Entorno exclusivo de pruebas', 'Lima', 'Lima', 'Lima', true, true
    );
  end if;

  select * into v_est
  from public.establishments
  where organization_id=v_org.id and code='QA-001';

  if not exists (
    select 1 from public.complaint_books
    where organization_id=v_org.id and establishment_id=v_est.id and code='QA001'
  ) then
    insert into public.complaint_books (
      organization_id, establishment_id, code, next_number, active
    ) values (
      v_org.id, v_est.id, 'QA001', 1, true
    );
  end if;

  insert into public.organization_domains (organization_id, hostname, active)
  values (v_org.id, 'lirep-public-api.vidadecanes-peru.workers.dev', true)
  on conflict (organization_id, hostname)
  do update set active=true, updated_at=now();
end $$;

commit;

select
  case when
    exists(select 1 from public.organizations where public_prefix='LIREPQA1' and active)
    and exists(
      select 1 from public.complaint_books b
      join public.organizations o on o.id=b.organization_id
      where o.public_prefix='LIREPQA1' and b.code='QA001' and b.active
    )
    and public.lirep_public_origin_allowed(
      'LIREPQA1',
      'https://lirep-public-api.vidadecanes-peru.workers.dev'
    )
  then 'PASS' else 'FAIL' end as v1_11_2_qa_tenant_status,
  (select b.next_number
   from public.complaint_books b
   join public.organizations o on o.id=b.organization_id
   where o.public_prefix='LIREPQA1' and b.code='QA001'
   limit 1) as qa_next_number,
  (select b.next_number
   from public.complaint_books b
   join public.organizations o on o.id=b.organization_id
   where o.public_prefix='VIDACANE' and b.code='LR001'
   limit 1) as production_lr001_next_number;
