-- QA231. Conciliar estados reales del servidor receptor mediante GET /emails/{id} de Resend.
-- Ningún envío nuevo ni reclamo nuevo: consulta solo correos ya aceptados en QA230.

create or replace function public.lirep_admin_response_evidence_claim()
returns jsonb
language plpgsql security definer
set search_path=''
as $$
declare v record;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'LIREP_EVIDENCE_ACCESS_DENIED' using errcode='42501';
  end if;

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
$$;

create or replace function public.lirep_admin_response_evidence_complete(
  p_evidence_id uuid,
  p_provider_message_id text,
  p_last_event text
)
returns jsonb
language plpgsql security definer
set search_path=''
as $$
declare
  v public.communication_evidence%rowtype;
  v_status text;
  v_event text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'LIREP_EVIDENCE_ACCESS_DENIED' using errcode='42501';
  end if;

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
$$;

-- La consulta del panel sigue verificando el acceso multiempresa y devuelve
-- claramente la diferencia entre aceptado y entregado.
create or replace function public.lirep_admin_response_delivery_status(
  p_organization_id uuid,p_complaint_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if not public.lirep_admin_can_access(p_organization_id,false) then
    raise exception 'LIREP_COMPLAINT_ACCESS_DENIED' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'response_id',r.id,
    'status',case
      when d.status='sent' and e.delivery_status='delivered' then 'delivered'
      when d.status='sent' and e.delivery_status='failed'
        then coalesce(e.metadata->>'last_event','failed')
      when d.status='sent' and e.delivery_status='complained' then 'complained'
      when d.status='sent' and e.delivery_status='delayed' then 'delayed'
      else coalesce(d.status,case when r.status='approved' then 'manual_required' else r.status end)
    end,
    'provider_event',e.metadata->>'last_event',
    'delivery_confirmed_at',e.delivered_at,
    'attempts',coalesce(d.attempts,0),
    'sent_at',d.sent_at,
    'provider_message_id',d.provider_message_id,
    'last_error',d.last_error
  ) order by r.submitted_at desc),'[]'::jsonb)
  into v_result
  from public.lirep_admin_official_responses r
  left join public.lirep_admin_response_delivery d
    on d.response_id=r.id and d.organization_id=r.organization_id
   and d.complaint_id=r.complaint_id
  left join lateral (
    select ev.delivery_status,ev.delivered_at,ev.metadata
    from public.communication_evidence ev
    where ev.organization_id=r.organization_id
      and ev.complaint_id=r.complaint_id
      and ev.metadata->>'kind'='official_response'
      and ev.metadata->>'response_id'=r.id::text
      and ev.external_message_id=d.provider_message_id
    order by ev.created_at desc
    limit 1
  ) e on true
  where r.organization_id=p_organization_id
    and r.complaint_id=p_complaint_id;
  return v_result;
end;
$$;

revoke all on function public.lirep_admin_response_evidence_claim() from public,anon,authenticated;
revoke all on function public.lirep_admin_response_evidence_complete(uuid,text,text) from public,anon,authenticated;
grant execute on function public.lirep_admin_response_evidence_claim() to service_role;
grant execute on function public.lirep_admin_response_evidence_complete(uuid,text,text) to service_role;

revoke all on function public.lirep_admin_response_delivery_status(uuid,uuid) from public,anon;
grant execute on function public.lirep_admin_response_delivery_status(uuid,uuid) to authenticated;
