-- LIREP V1.11.9 · QA post-E2E multiempresa
-- Read-only verification. Does not modify records or counters.

do $$
declare
  v_qa_org uuid;
  v_prod_org uuid;
  v_qa_book uuid;
  v_prod_book uuid;
  v_qa_next bigint;
  v_prod_next bigint;
  v_qa_count bigint;
  v_bad_count bigint;
begin
  select id into v_qa_org
  from public.organizations
  where public_prefix = 'LIREPQA1';

  select id into v_prod_org
  from public.organizations
  where public_prefix = 'VIDACANE';

  if v_qa_org is null then raise exception 'QA_ORGANIZATION_NOT_FOUND'; end if;
  if v_prod_org is null then raise exception 'PRODUCTION_ORGANIZATION_NOT_FOUND'; end if;

  select cb.id, cb.next_number
    into v_qa_book, v_qa_next
  from public.complaint_books cb
  join public.establishments e on e.id = cb.establishment_id
  where cb.organization_id = v_qa_org
    and e.code = 'QA-001'
    and cb.code = 'QA001';

  select cb.id, cb.next_number
    into v_prod_book, v_prod_next
  from public.complaint_books cb
  join public.establishments e on e.id = cb.establishment_id
  where cb.organization_id = v_prod_org
    and cb.code = 'LR001';

  if v_qa_book is null then raise exception 'QA_BOOK_NOT_FOUND'; end if;
  if v_prod_book is null then raise exception 'PRODUCTION_BOOK_NOT_FOUND'; end if;

  select count(*) into v_qa_count
  from public.complaints c
  where c.organization_id = v_qa_org
    and c.book_id = v_qa_book
    and c.public_code = 'LIREPQA1-QA001-2026-00000001';

  select count(*) into v_bad_count
  from public.complaints c
  where c.public_code = 'LIREPQA1-QA001-2026-00000001'
    and c.organization_id <> v_qa_org;

  if v_qa_next <> 2 then
    raise exception 'QA_NEXT_NUMBER_EXPECTED_2_ACTUAL_%', v_qa_next;
  end if;

  if v_prod_next <> 2 then
    raise exception 'PRODUCTION_NEXT_NUMBER_CHANGED_EXPECTED_2_ACTUAL_%', v_prod_next;
  end if;

  if v_qa_count <> 1 then
    raise exception 'QA_COMPLAINT_EXPECTED_1_ACTUAL_%', v_qa_count;
  end if;

  if v_bad_count <> 0 then
    raise exception 'TENANT_ISOLATION_FAILED_%', v_bad_count;
  end if;
end $$;

select
  'PASS'::text as result,
  (select next_number from public.complaint_books where code='QA001' limit 1) as qa_next_number,
  (select next_number from public.complaint_books where code='LR001' limit 1) as production_next_number,
  (select public_code from public.complaints where public_code='LIREPQA1-QA001-2026-00000001' limit 1) as qa_public_code;
