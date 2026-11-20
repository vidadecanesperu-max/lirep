-- QA246 | Read-through provider status of ONE authorized company's official email.
-- Existing scheduler remains unchanged. The Worker validates user membership,
-- calls these service_role-only functions and never sends a second email.
CREATE OR REPLACE FUNCTION public.lirep_admin_response_evidence_claim_one(
 p_organization_id uuid,
 p_response_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare v record;
begin
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
  where d.organization_id=p_organization_id
    and d.response_id=p_response_id
    and d.status='sent'
    and e.metadata->>'kind'='official_response'
    and e.delivery_status in ('sent','delayed')
    and e.sent_at >= now() - interval '7 days'
    and e.sent_at < now() - interval '2 minutes'
    and (
      e.metadata->>'last_checked_at' is null
      or (e.metadata->>'last_checked_at')::timestamptz < now() - interval '60 seconds'
    )
  order by e.sent_at,e.id
  for update of e skip locked
  limit 1;
  if not found then return null; end if;
  update public.communication_evidence e
  set metadata = e.metadata || jsonb_build_object(
    'last_checked_at',now(),
    'check_count',coalesce((e.metadata->>'check_count')::integer,0)+1
  ) where e.id=v.evidence_id;
  return jsonb_build_object(
    'evidence_id',v.evidence_id,
    'response_id',v.response_id,
    'provider_message_id',v.provider_message_id,
    'recipient',v.recipient
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.lirep_admin_response_evidence_claim_one(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_response_evidence_claim_one(uuid,uuid)
  TO service_role;

-- Expose the last provider check timestamp through the already-authorized,
-- read-only administrative delivery status endpoint. No consumer data added.
CREATE OR REPLACE FUNCTION public.lirep_admin_response_delivery_status(p_organization_id uuid, p_complaint_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if not public.lirep_admin_can_access(p_organization_id,false) then
    raise exception 'LIREP_COMPLAINT_ACCESS_DENIED' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'response_id',r.id,
    'status',case
      when p.id is not null and p.delivery_status='delivered' then 'postal_delivered'
      when p.id is not null and p.delivery_status='failed' then 'postal_returned'
      when p.id is not null then 'postal_dispatched'
      when d.status='sent' and e.delivery_status='delivered' then 'delivered'
      when d.status='sent' and e.delivery_status='failed'
        then coalesce(e.metadata->>'last_event','failed')
      when d.status='sent' and e.delivery_status='complained' then 'complained'
      when d.status='sent' and e.delivery_status='delayed' then 'delayed'
      else coalesce(d.status,case when r.status='approved' then
        case when coalesce(c.official_delivery_method,case when
          nullif(btrim(coalesce(case when co.is_minor then co.representative_email else co.email end,'')),'') is not null
          then 'email' else 'postal' end)='postal'
        then 'postal_pending' else 'manual_required' end
        else r.status end)
    end,
    'channel',case when p.id is not null then 'postal'
      else coalesce(c.official_delivery_method,'email') end,
    'paper_reference',p.external_message_id,
    'provider_event',e.metadata->>'last_event',
    'provider_checked_at',e.metadata->>'last_checked_at',
    'delivery_confirmed_at',coalesce(p.delivered_at,e.delivered_at),
    'attempts',coalesce(d.attempts,0),
    'sent_at',coalesce(p.sent_at,d.sent_at),
    'provider_message_id',d.provider_message_id,
    'last_error',d.last_error
  ) order by r.submitted_at desc),'[]'::jsonb)
  into v_result
  from public.lirep_admin_official_responses r
  join public.complaints c on c.id=r.complaint_id and c.organization_id=r.organization_id
  join public.consumers co on co.id=c.consumer_id and co.organization_id=c.organization_id
  left join public.lirep_admin_response_delivery d
    on d.response_id=r.id and d.organization_id=r.organization_id
   and d.complaint_id=r.complaint_id
  left join lateral (
    select ev.delivery_status,ev.delivered_at,ev.metadata
    from public.communication_evidence ev
    where ev.organization_id=r.organization_id and ev.complaint_id=r.complaint_id
      and ev.metadata->>'kind'='official_response'
      and ev.metadata->>'response_id'=r.id::text
      and ev.channel='email'
      and ev.external_message_id=d.provider_message_id
    order by ev.created_at desc limit 1
  ) e on true
  left join lateral (
    select ev.id,ev.delivery_status,ev.sent_at,ev.delivered_at,ev.external_message_id
    from public.communication_evidence ev
    where ev.organization_id=r.organization_id and ev.complaint_id=r.complaint_id
      and ev.metadata->>'kind'='official_response'
      and ev.metadata->>'response_id'=r.id::text and ev.channel='postal'
    order by ev.created_at desc limit 1
  ) p on true
  where r.organization_id=p_organization_id and r.complaint_id=p_complaint_id;
  return v_result;
end $function$;
