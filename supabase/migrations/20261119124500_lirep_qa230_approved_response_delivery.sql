-- LIREP QA230: entregas de respuestas aprobadas, sin reenviar respuestas históricas.
-- La cola y su disparador de aprobación existen en producción.
-- Solo el Worker autenticado como service_role puede reclamar/completar envíos.

create or replace function public.lirep_admin_response_delivery_claim()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
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
$$;

create or replace function public.lirep_admin_response_delivery_complete(
  p_queue_id uuid,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_retryable boolean default false
)
returns jsonb
language plpgsql security definer
set search_path=''
as $$
declare
  v public.lirep_admin_response_delivery%rowtype;
  v_next_status text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'LIREP_DELIVERY_ACCESS_DENIED' using errcode='42501';
  end if;

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
$$;

-- Estado consultable por la empresa, nunca por otro tenant.
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
    'status',coalesce(d.status,case when r.status='approved' then 'manual_required' else r.status end),
    'attempts',coalesce(d.attempts,0),
    'sent_at',d.sent_at,
    'provider_message_id',d.provider_message_id,
    'last_error',d.last_error
  ) order by r.submitted_at desc),'[]'::jsonb)
  into v_result
  from public.lirep_admin_official_responses r
  left join public.lirep_admin_response_delivery d
    on d.response_id=r.id and d.organization_id=r.organization_id and d.complaint_id=r.complaint_id
  where r.organization_id=p_organization_id and r.complaint_id=p_complaint_id;
  return v_result;
end;
$$;

revoke all on function public.lirep_admin_response_delivery_claim() from public,anon,authenticated;
revoke all on function public.lirep_admin_response_delivery_complete(uuid,boolean,text,text,boolean) from public,anon,authenticated;
grant execute on function public.lirep_admin_response_delivery_claim() to service_role;
grant execute on function public.lirep_admin_response_delivery_complete(uuid,boolean,text,text,boolean) to service_role;

revoke all on function public.lirep_admin_response_delivery_status(uuid,uuid) from public,anon;
grant execute on function public.lirep_admin_response_delivery_status(uuid,uuid) to authenticated;

-- El trigger de encolado no debe estar disponible como RPC pública.
revoke all on function public.lirep_admin_queue_approved_response() from public,anon,authenticated;
