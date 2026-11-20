-- QA244: process an explicit approved response for one authorized organization.
-- This RPC can only be called by the Worker with service_role.
-- Reuses the exact FOR UPDATE SKIP LOCKED + pending/retry state transitions of the scheduler.
-- Never duplicates an already sending or sent delivery.
CREATE OR REPLACE FUNCTION public.lirep_admin_response_delivery_claim_one(p_organization_id uuid,p_response_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'LIREP_DELIVERY_ACCESS_DENIED' using errcode='42501';
  end if;

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
$function$
;
revoke all on function public.lirep_admin_response_delivery_claim_one(uuid,uuid) from PUBLIC,anon,authenticated;
grant execute on function public.lirep_admin_response_delivery_claim_one(uuid,uuid) to service_role;
