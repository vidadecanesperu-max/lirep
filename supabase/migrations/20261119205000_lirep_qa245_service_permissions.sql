-- QA245: service-only internal RPCs rejected valid Worker calls in PostgREST 14
-- because the deprecated request.jwt.claim.role GUC is not reliable.
-- Access is enforced at SQL EXECUTE privilege layer: PUBLIC, anon and
-- authenticated are revoked; only service_role may execute these functions.
-- No authorization broadening. No queue status changes or real email sends.

CREATE OR REPLACE FUNCTION public.lirep_admin_response_delivery_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  -- Authorized exclusively by EXECUTE GRANT for service_role.

  select
    d.id as queue_id, d.response_id, d.organization_id, d.complaint_id,
    d.recipient, d.attempts, r.body as response_body, r.status as response_status,
    c.public_code,
    coalesce(nullif(o.trade_name,''),o.legal_name) as company_name
  into v
  from public.lirep_admin_response_delivery d
  join public.lirep_admin_official_responses r
    on r.id=d.response_id
   and r.organization_id=d.organization_id
   and r.complaint_id=d.complaint_id
  join public.complaints c
    on c.id=d.complaint_id and c.organization_id=d.organization_id
  join public.organizations o
    on o.id=d.organization_id
  where d.status in ('pending','retry')
    and d.next_attempt_at <= now()
    and d.attempts < 4
    and r.status='approved'
    and o.active=true
  order by d.created_at,d.id
  limit 1
  for update of d skip locked;

  if not found then
    return null;
  end if;

  update public.lirep_admin_response_delivery
  set status='sending', attempts=attempts+1, locked_at=now(),last_error=null
  where id=v.queue_id and status in ('pending','retry');

  return jsonb_build_object(
    'queue_id',v.queue_id,'response_id',v.response_id,
    'organization_id',v.organization_id,'complaint_id',v.complaint_id,
    'recipient',v.recipient,'public_code',v.public_code,
    'company_name',v.company_name,'body',v.response_body
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.lirep_admin_response_delivery_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_response_delivery_claim() TO service_role;

CREATE OR REPLACE FUNCTION public.lirep_admin_response_delivery_claim_one(p_organization_id uuid, p_response_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  -- Authorized exclusively by EXECUTE GRANT for service_role.

  select
    d.id as queue_id, d.response_id, d.organization_id, d.complaint_id,
    d.recipient, d.attempts, r.body as response_body, r.status as response_status,
    c.public_code,
    coalesce(nullif(o.trade_name,''),o.legal_name) as company_name
  into v
  from public.lirep_admin_response_delivery d
  join public.lirep_admin_official_responses r
    on r.id=d.response_id
   and r.organization_id=d.organization_id
   and r.complaint_id=d.complaint_id
  join public.complaints c
    on c.id=d.complaint_id and c.organization_id=d.organization_id
  join public.organizations o
    on o.id=d.organization_id
  where d.organization_id=p_organization_id
    and d.response_id=p_response_id
    and d.status in ('pending','retry')
    and d.next_attempt_at <= now()
    and d.attempts < 4
    and r.status='approved'
    and o.active=true
  order by d.created_at,d.id
  limit 1
  for update of d skip locked;

  if not found then
    return null;
  end if;

  update public.lirep_admin_response_delivery
  set status='sending', attempts=attempts+1, locked_at=now(),last_error=null
  where id=v.queue_id and status in ('pending','retry');

  return jsonb_build_object(
    'queue_id',v.queue_id,'response_id',v.response_id,
    'organization_id',v.organization_id,'complaint_id',v.complaint_id,
    'recipient',v.recipient,'public_code',v.public_code,
    'company_name',v.company_name,'body',v.response_body
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.lirep_admin_response_delivery_claim_one(p_organization_id uuid, p_response_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_response_delivery_claim_one(p_organization_id uuid, p_response_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lirep_admin_response_delivery_complete(p_queue_id uuid, p_success boolean, p_provider_message_id text DEFAULT NULL::text, p_error text DEFAULT NULL::text, p_retryable boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.lirep_admin_response_delivery%rowtype;
  v_next_status text;
begin
  -- Authorized exclusively by EXECUTE GRANT for service_role.

  select * into v
  from public.lirep_admin_response_delivery d
  where d.id=p_queue_id
  for update;

  if v.id is null then
    raise exception 'LIREP_DELIVERY_NOT_FOUND' using errcode='22023';
  end if;
  if v.status='sent' then
    return jsonb_build_object('ok',true,'status','sent','already_completed',true);
  end if;
  if v.status<>'sending' then
    raise exception 'LIREP_DELIVERY_NOT_IN_PROGRESS' using errcode='22023';
  end if;

  if p_success is true then
    if nullif(btrim(coalesce(p_provider_message_id,'')),'') is null then
      raise exception 'LIREP_PROVIDER_ID_REQUIRED' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.lirep_admin_official_responses r
      where r.id=v.response_id and r.complaint_id=v.complaint_id
        and r.organization_id=v.organization_id and r.status='approved'
    ) then
      raise exception 'LIREP_RESPONSE_NOT_APPROVED' using errcode='42501';
    end if;

    update public.lirep_admin_response_delivery
    set status='sent', sent_at=now(), locked_at=null, last_error=null,
        provider_message_id=left(p_provider_message_id,250)
    where id=v.id;

    -- "sent" representa aceptación del proveedor, no confirmación de lectura.
    insert into public.communication_evidence (
      organization_id,complaint_id,channel,destination,provider,
      external_message_id,delivery_status,sent_at,metadata
    ) values (
      v.organization_id,v.complaint_id,'email',v.recipient,'resend',
      left(p_provider_message_id,250),'sent',now(),
      jsonb_build_object('kind','official_response','response_id',v.response_id,'queue_id',v.id,
                         'evidence_type','provider_accepted')
    );

    return jsonb_build_object('ok',true,'status','sent','already_completed',false);
  end if;

  v_next_status := case when p_retryable is true and v.attempts < 4
    then 'retry' else 'failed' end;

  update public.lirep_admin_response_delivery
  set status=v_next_status,locked_at=null,
      next_attempt_at=now()+make_interval(mins=>v.attempts*10),
      last_error=left(coalesce(nullif(btrim(p_error),''),'EMAIL_DELIVERY_FAILED'),500)
  where id=v.id;
  return jsonb_build_object('ok',true,'status',v_next_status,'attempts',v.attempts);
end;
$function$;
REVOKE ALL ON FUNCTION public.lirep_admin_response_delivery_complete(p_queue_id uuid, p_success boolean, p_provider_message_id text, p_error text, p_retryable boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_response_delivery_complete(p_queue_id uuid, p_success boolean, p_provider_message_id text, p_error text, p_retryable boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.lirep_admin_response_evidence_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v record;
begin
  -- Authorized exclusively by EXECUTE GRANT for service_role.

  select
    e.id as evidence_id,e.organization_id,e.complaint_id,
    d.response_id,d.provider_message_id,d.recipient
  into v
  from public.communication_evidence e
  join public.lirep_admin_response_delivery d
    on d.organization_id=e.organization_id
   and d.complaint_id=e.complaint_id
   and d.provider_message_id=e.external_message_id
   and (e.metadata->>'queue_id')=d.id::text
   and (e.metadata->>'response_id')=d.response_id::text
  where d.status='sent'
    and e.metadata->>'kind'='official_response'
    and e.delivery_status in ('sent','delayed')
    and e.sent_at >= now() - interval '7 days'
    and e.sent_at < now() - interval '2 minutes'
    and (
      e.metadata->>'last_checked_at' is null
      or (e.metadata->>'last_checked_at')::timestamptz < now() - interval '30 minutes'
    )
  order by e.sent_at,e.id
  for update of e skip locked
  limit 1;

  if not found then return null; end if;

  update public.communication_evidence e
  set metadata = e.metadata || jsonb_build_object(
    'last_checked_at',now(),
    'check_count',coalesce((e.metadata->>'check_count')::integer,0)+1
  )
  where e.id=v.evidence_id;

  return jsonb_build_object(
    'evidence_id',v.evidence_id,
    'response_id',v.response_id,
    'provider_message_id',v.provider_message_id,
    'recipient',v.recipient
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.lirep_admin_response_evidence_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_response_evidence_claim() TO service_role;

CREATE OR REPLACE FUNCTION public.lirep_admin_response_evidence_complete(p_evidence_id uuid, p_provider_message_id text, p_last_event text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.communication_evidence%rowtype;
  v_status text;
  v_event text;
begin
  -- Authorized exclusively by EXECUTE GRANT for service_role.

  v_event:=lower(btrim(coalesce(p_last_event,'')));
  if v_event not in ('sent','received','delivered','opened','clicked','bounced',
                     'suppressed','delivery_delayed','failed','complained') then
    raise exception 'LIREP_UNSUPPORTED_PROVIDER_EVENT' using errcode='22023';
  end if;

  select * into v from public.communication_evidence
  where id=p_evidence_id and external_message_id=p_provider_message_id
    and metadata->>'kind'='official_response'
  for update;
  if v.id is null then
    raise exception 'LIREP_EVIDENCE_NOT_FOUND' using errcode='22023';
  end if;
  -- Transición monotónica: nunca degradar una entrega ya confirmada.
  if v.delivery_status in ('delivered','failed','complained') then
    return jsonb_build_object('ok',true,'status',v.delivery_status,'already_final',true);
  end if;
  if not exists (
    select 1 from public.lirep_admin_response_delivery d
    where d.organization_id=v.organization_id and d.complaint_id=v.complaint_id
      and d.provider_message_id=v.external_message_id and d.status='sent'
      and d.id::text=v.metadata->>'queue_id'
  ) then
    raise exception 'LIREP_EVIDENCE_QUEUE_MISMATCH' using errcode='42501';
  end if;

  v_status:=case
    when v_event in ('delivered','opened','clicked') then 'delivered'
    when v_event in ('bounced','suppressed','failed') then 'failed'
    when v_event='complained' then 'complained'
    when v_event='delivery_delayed' then 'delayed'
    else 'sent'
  end;

  update public.communication_evidence
  set delivery_status=v_status,
      delivered_at=case when v_status='delivered' then now() else delivered_at end,
      metadata=metadata || jsonb_build_object('last_event',v_event,'event_verified_at',now())
  where id=v.id;
  return jsonb_build_object('ok',true,'status',v_status,'provider_event',v_event);
end;
$function$;
REVOKE ALL ON FUNCTION public.lirep_admin_response_evidence_complete(p_evidence_id uuid, p_provider_message_id text, p_last_event text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_response_evidence_complete(p_evidence_id uuid, p_provider_message_id text, p_last_event text) TO service_role;

CREATE OR REPLACE FUNCTION public.lirep_public_case_tracking(p_public_prefix text, p_public_code text, p_access_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb;
begin
  -- Authorized exclusively by EXECUTE GRANT for service_role.
  if coalesce(p_public_prefix,'') !~ '^[A-Z0-9]{8}$'
    or coalesce(p_public_code,'') !~ '^[A-Z0-9-]{10,80}$'
    or p_access_token is null then return null; end if;
  select jsonb_build_object(
    'code',c.public_code,'status',c.status,
    'submitted_at',c.submitted_at,'due_at',c.response_due_at,
    'responded_at',c.responded_at,'closed_at',c.closed_at,
    'official_delivery_method',coalesce(c.official_delivery_method,case
      when nullif(btrim(coalesce(case when co.is_minor then co.representative_email else co.email end,'')),'') is not null
      then 'email' else 'postal' end),
    'history',coalesce((
       select jsonb_agg(jsonb_build_object(
         'event','status','status',h.new_status,'at',h.created_at
       ) order by h.created_at,h.id)
       from public.complaint_status_history h
       where h.organization_id=c.organization_id and h.complaint_id=c.id
    ),'[]'::jsonb),
    'communications',coalesce((
       select jsonb_agg(jsonb_build_object(
         'channel',ev.channel,'status',ev.delivery_status,
         'sent_at',ev.sent_at,'delivered_at',ev.delivered_at
       ) order by ev.created_at)
       from public.communication_evidence ev
       where ev.organization_id=c.organization_id and ev.complaint_id=c.id
         and ev.metadata->>'kind'='official_response'
    ),'[]'::jsonb)
  ) into v
  from public.complaints c
  join public.organizations o on o.id=c.organization_id and o.active
  join public.consumers co on co.id=c.consumer_id and co.organization_id=c.organization_id
  join public.complaint_receipt_tokens t on t.complaint_id=c.id
       and t.organization_id=c.organization_id
       and t.access_token=p_access_token and t.revoked_at is null
  where o.public_prefix=p_public_prefix and c.public_code=p_public_code;
  return v;
end $function$;
REVOKE ALL ON FUNCTION public.lirep_public_case_tracking(p_public_prefix text, p_public_code text, p_access_token uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_public_case_tracking(p_public_prefix text, p_public_code text, p_access_token uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lirep_submit_public_complaint_gateway(p_idempotency_key uuid, p_public_prefix text, p_establishment_code text, p_book_code text, p_document_type lirep_consumer_document_type, p_document_number text, p_first_names text, p_last_names text, p_email text, p_phone text, p_address text, p_is_minor boolean, p_representative_first_names text, p_representative_last_names text, p_representative_document_type lirep_consumer_document_type, p_representative_document_number text, p_representative_phone text, p_representative_email text, p_complaint_type lirep_complaint_type, p_product_service_type text, p_product_service_description text, p_amount numeric, p_detail text, p_consumer_request text, p_consumer_conformity boolean, p_preferred_response_channel text, p_official_delivery_method text)
 RETURNS TABLE(complaint_id uuid, public_code text, sequence_number bigint, submitted_at timestamp with time zone, response_due_at timestamp with time zone, duplicate boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v record; v_current text;
begin
  -- Authorized exclusively by EXECUTE GRANT for service_role.
  if p_official_delivery_method not in ('email','postal') or p_official_delivery_method is null then
    raise exception 'LIREP_INVALID_DELIVERY_METHOD' using errcode='22023';
  end if;
  if p_official_delivery_method='email' and
     (coalesce(nullif(btrim(case when p_is_minor then p_representative_email else p_email end),''),'')='' or
      btrim(case when p_is_minor then p_representative_email else p_email end) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  then
    raise exception 'LIREP_OFFICIAL_EMAIL_REQUIRED' using errcode='22023';
  end if;
  if p_official_delivery_method='postal' and nullif(btrim(coalesce(p_address,'')),'') is null then
    raise exception 'LIREP_POSTAL_ADDRESS_REQUIRED' using errcode='22023';
  end if;
  select * into v from public.lirep_submit_public_complaint_gateway(
    p_idempotency_key,p_public_prefix,p_establishment_code,p_book_code,
    p_document_type,p_document_number,p_first_names,p_last_names,p_email,
    p_phone,p_address,p_is_minor,p_representative_first_names,
    p_representative_last_names,p_representative_document_type,
    p_representative_document_number,p_representative_phone,
    p_representative_email,p_complaint_type,p_product_service_type,
    p_product_service_description,p_amount,p_detail,p_consumer_request,
    p_consumer_conformity,p_preferred_response_channel
  );
  if v.complaint_id is null then raise exception 'LIREP_SUBMISSION_MISSING'; end if;
  select c.official_delivery_method into v_current
  from public.complaints c where c.id=v.complaint_id
    and c.organization_id=(select id from public.organizations where public_prefix=upper(btrim(p_public_prefix)))
  for update;
  if v_current is not null and v_current<>p_official_delivery_method then
    raise exception 'LIREP_IDEMPOTENCY_METHOD_MISMATCH' using errcode='23505';
  end if;
  update public.complaints c set official_delivery_method=p_official_delivery_method
    where c.id=v.complaint_id and c.official_delivery_method is distinct from p_official_delivery_method;
  return query select v.complaint_id::uuid,v.public_code::text,v.sequence_number::bigint,
    v.submitted_at::timestamptz,v.response_due_at::timestamptz,v.duplicate::boolean;
end $function$;
REVOKE ALL ON FUNCTION public.lirep_submit_public_complaint_gateway(p_idempotency_key uuid, p_public_prefix text, p_establishment_code text, p_book_code text, p_document_type lirep_consumer_document_type, p_document_number text, p_first_names text, p_last_names text, p_email text, p_phone text, p_address text, p_is_minor boolean, p_representative_first_names text, p_representative_last_names text, p_representative_document_type lirep_consumer_document_type, p_representative_document_number text, p_representative_phone text, p_representative_email text, p_complaint_type lirep_complaint_type, p_product_service_type text, p_product_service_description text, p_amount numeric, p_detail text, p_consumer_request text, p_consumer_conformity boolean, p_preferred_response_channel text, p_official_delivery_method text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_submit_public_complaint_gateway(p_idempotency_key uuid, p_public_prefix text, p_establishment_code text, p_book_code text, p_document_type lirep_consumer_document_type, p_document_number text, p_first_names text, p_last_names text, p_email text, p_phone text, p_address text, p_is_minor boolean, p_representative_first_names text, p_representative_last_names text, p_representative_document_type lirep_consumer_document_type, p_representative_document_number text, p_representative_phone text, p_representative_email text, p_complaint_type lirep_complaint_type, p_product_service_type text, p_product_service_description text, p_amount numeric, p_detail text, p_consumer_request text, p_consumer_conformity boolean, p_preferred_response_channel text, p_official_delivery_method text) TO service_role;
