-- LIREP V1.13.1 · QA delivery queue (transactional / rollback)
-- Tests existing QA complaint only. No email is sent and no persistent queue/evidence changes remain.

begin;

do $$
declare
  v_result jsonb;
  v_claim jsonb;
  v_queue_id uuid;
  v_status text;
  v_attempts integer;
  v_prod_queue bigint;
begin
  select public.lirep_queue_receipt_email(
    'LIREPQA1',
    'LIREPQA1-QA001-2026-00000001'
  ) into v_result;

  if coalesce((v_result->>'queued')::boolean,false) is not true then
    raise exception 'QUEUE_FAILED_%', v_result;
  end if;

  v_queue_id := (v_result->>'queue_id')::uuid;

  select public.lirep_claim_receipt_email() into v_claim;

  if v_claim is null then
    raise exception 'CLAIM_RETURNED_NULL';
  end if;

  if (v_claim->>'queue_id')::uuid <> v_queue_id then
    raise exception 'CLAIMED_UNEXPECTED_QUEUE_ITEM';
  end if;

  if v_claim#>>'{receipt,public_code}' <> 'LIREPQA1-QA001-2026-00000001' then
    raise exception 'CLAIM_TENANT_OR_RECEIPT_MISMATCH';
  end if;

  select status,attempt_count into v_status,v_attempts
  from public.complaint_delivery_queue
  where id=v_queue_id;

  if v_status <> 'processing' or v_attempts <> 1 then
    raise exception 'CLAIM_STATE_INVALID_%_%',v_status,v_attempts;
  end if;

  perform public.lirep_complete_receipt_email(
    v_queue_id,
    false,
    'qa-simulated',
    null,
    'QA_SIMULATED_FAILURE'
  );

  select status into v_status
  from public.complaint_delivery_queue
  where id=v_queue_id;

  if v_status <> 'failed' then
    raise exception 'FAILURE_STATE_NOT_RECORDED_%',v_status;
  end if;

  select count(*) into v_prod_queue
  from public.complaint_delivery_queue q
  join public.organizations o on o.id=q.organization_id
  where o.public_prefix='VIDACANE';

  if v_prod_queue <> 0 then
    raise exception 'PRODUCTION_QUEUE_MUST_REMAIN_EMPTY_%',v_prod_queue;
  end if;
end $$;

select
  'PASS'::text as result,
  'LIREPQA1-QA001-2026-00000001'::text as qa_public_code,
  2::bigint as expected_qa_next_number,
  (select cb.next_number from public.complaint_books cb join public.organizations o on o.id=cb.organization_id where o.public_prefix='LIREPQA1' and cb.code='QA001' limit 1) as actual_qa_next_number,
  (select cb.next_number from public.complaint_books cb join public.organizations o on o.id=cb.organization_id where o.public_prefix='VIDACANE' and cb.code='LR001' limit 1) as production_next_number,
  'ROLLBACK_PENDING'::text as persistence;

rollback;
