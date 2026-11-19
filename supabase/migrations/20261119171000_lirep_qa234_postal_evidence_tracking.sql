-- QA234 Phase 2: documented postal service, status transitions, tenant-safe tracking.
-- No existing complaint, response or evidence is updated by this migration.

create unique index if not exists lirep_official_paper_one_record_per_response
on public.communication_evidence ((metadata->>'response_id'))
where channel='postal' and metadata->>'kind'='official_response';

-- New official answer starts administrative review, without claiming consumer was notified.
create or replace function public.lirep_official_response_open_tracking()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  update public.complaints
  set status='in_review'
  where id=new.complaint_id and organization_id=new.organization_id and status='submitted';
  return new;
end $$;

drop trigger if exists lirep_official_response_open_tracking on public.lirep_admin_official_responses;
create trigger lirep_official_response_open_tracking
after insert on public.lirep_admin_official_responses
for each row execute function public.lirep_official_response_open_tracking();

-- Responded is recorded only after confirmed recipient-server email delivery,
-- or paper delivery declared with a proof reference. Email sent != delivered.
create or replace function public.lirep_official_delivery_status_tracking()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_response uuid;
begin
  if new.metadata->>'kind' <> 'official_response'
    or new.delivery_status <> 'delivered'
    or (tg_op='UPDATE' and old.delivery_status='delivered')
  then return new; end if;

  if new.metadata->>'response_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  v_response := (new.metadata->>'response_id')::uuid;
  if not exists(
    select 1 from public.lirep_admin_official_responses r
    where r.id=v_response and r.organization_id=new.organization_id
      and r.complaint_id=new.complaint_id and r.status='approved'
  ) then return new; end if;

  update public.complaints
  set status='responded', responded_at=coalesce(responded_at,now())
  where organization_id=new.organization_id and id=new.complaint_id
    and status in ('submitted','in_review');

  return new;
end $$;

drop trigger if exists lirep_official_delivery_status_tracking on public.communication_evidence;
create trigger lirep_official_delivery_status_tracking
after insert or update of delivery_status on public.communication_evidence
for each row execute function public.lirep_official_delivery_status_tracking();

-- Paper letter evidence. No automatic emails, no success without an actor
-- and a reference to the postal tracking / signed receipt / other proof.
create or replace function public.lirep_admin_record_paper_delivery(
  p_organization_id uuid,p_response_id uuid,p_action text,
  p_reference text,p_note text default null
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v record; v_evidence public.communication_evidence%rowtype;
  v_reference text:=nullif(btrim(coalesce(p_reference,'')),'');
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_status text; v_event jsonb; v_address text;
begin
  if not public.lirep_admin_can_access(p_organization_id,true) then
    raise exception 'LIREP_PAPER_ACCESS_DENIED' using errcode='42501';
  end if;
  if p_action not in ('dispatched','delivered','returned') or p_action is null then
    raise exception 'LIREP_INVALID_PAPER_ACTION' using errcode='22023';
  end if;
  if length(coalesce(v_reference,'')) not between 5 and 200 then
    raise exception 'LIREP_PAPER_PROOF_REFERENCE_REQUIRED' using errcode='22023';
  end if;
  if length(coalesce(v_note,''))>2000 or
     (p_action in ('delivered','returned') and length(coalesce(v_note,'')) < 10)
  then
    raise exception 'LIREP_PAPER_NOTE_REQUIRED' using errcode='22023';
  end if;

  select r.complaint_id,r.organization_id,r.status,
         co.address,
         coalesce(c.official_delivery_method,case
           when nullif(btrim(coalesce(case when co.is_minor then co.representative_email else co.email end,'')),'') is null then 'postal'
           else 'email' end) method
  into v
  from public.lirep_admin_official_responses r
  join public.complaints c on c.id=r.complaint_id and c.organization_id=r.organization_id
  join public.consumers co on co.id=c.consumer_id and co.organization_id=c.organization_id
  where r.id=p_response_id and r.organization_id=p_organization_id
  for update of r;

  if not found then raise exception 'LIREP_RESPONSE_NOT_FOUND' using errcode='22023'; end if;
  if v.status<>'approved' or v.method<>'postal' then
    raise exception 'LIREP_PAPER_NOT_ELIGIBLE' using errcode='42501';
  end if;
  v_address:=nullif(btrim(coalesce(v.address,'')),'');
  if v_address is null then
    raise exception 'LIREP_PAPER_ADDRESS_REQUIRED' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_response_id::text,234));
  select * into v_evidence from public.communication_evidence e
  where e.organization_id=p_organization_id
    and e.complaint_id=v.complaint_id and e.channel='postal'
    and e.metadata->>'kind'='official_response'
    and e.metadata->>'response_id'=p_response_id::text
  for update;

  if v_evidence.id is not null and v_evidence.delivery_status in ('delivered','failed') then
    raise exception 'LIREP_PAPER_ALREADY_FINAL' using errcode='22023';
  end if;

  v_status:=case when p_action='dispatched' then 'sent'
                 when p_action='delivered' then 'delivered'
                 else 'failed' end;
  v_event:=jsonb_build_object(
    'action',p_action,'at',now(),'actor',auth.uid(),
    'reference',v_reference,'note',v_note
  );
  if v_evidence.id is null then
    if p_action='returned' then
      raise exception 'LIREP_PAPER_MUST_BE_DISPATCHED' using errcode='22023';
    end if;
    insert into public.communication_evidence(
      organization_id,complaint_id,channel,destination,
      provider,external_message_id,delivery_status,sent_at,delivered_at,metadata
    ) values(
      p_organization_id,v.complaint_id,'postal',v_address,
      'manual_record',v_reference,v_status,
      case when p_action='dispatched' then now() else null end,
      case when p_action='delivered' then now() else null end,
      jsonb_build_object('kind','official_response','response_id',p_response_id,
                         'proof_type','manual_reference','events',jsonb_build_array(v_event),
                         'last_event',p_action)
    ) returning * into v_evidence;
  else
    update public.communication_evidence
      set delivery_status=v_status,
        delivered_at=case when p_action='delivered' then now() else delivered_at end,
        sent_at=coalesce(sent_at,now()),
        metadata=metadata || jsonb_build_object(
          'last_event',p_action,
          'events',coalesce(metadata->'events','[]'::jsonb)||jsonb_build_array(v_event)
        )
    where id=v_evidence.id returning * into v_evidence;
  end if;
  return jsonb_build_object('ok',true,'evidence_id',v_evidence.id,
                            'status',v_status,'channel','postal',
                            'proof_recorded',true);
end $$;

revoke all on function public.lirep_admin_record_paper_delivery(uuid,uuid,text,text,text) from PUBLIC,anon;
grant execute on function public.lirep_admin_record_paper_delivery(uuid,uuid,text,text,text) to authenticated;

-- Tracking of a complaint by authorized company users, including a concise status history.
create or replace function public.lirep_admin_case_tracking(
  p_organization_id uuid,p_complaint_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;
begin
  if not public.lirep_admin_can_access(p_organization_id,false) then
    raise exception 'LIREP_COMPLAINT_ACCESS_DENIED' using errcode='42501';
  end if;
  select jsonb_build_object(
    'code',c.public_code,'status',c.status,'submitted_at',c.submitted_at,
    'due_at',c.response_due_at,'responded_at',c.responded_at,'closed_at',c.closed_at,
    'official_delivery_method',coalesce(c.official_delivery_method,case when
      nullif(btrim(coalesce(case when co.is_minor then co.representative_email else co.email end,'')),'') is not null
      then 'email' else 'postal' end),
    'history',coalesce((
      select jsonb_agg(jsonb_build_object(
        'status',h.new_status,'changed_at',h.created_at,
        'note',h.note
      ) order by h.created_at,h.id)
      from public.complaint_status_history h
      where h.organization_id=c.organization_id and h.complaint_id=c.id
    ),'[]'::jsonb)
  ) into v_result from public.complaints c
    join public.consumers co on co.id=c.consumer_id and co.organization_id=c.organization_id
    where c.organization_id=p_organization_id and c.id=p_complaint_id;
  return coalesce(v_result,'null'::jsonb);
end $$;

revoke all on function public.lirep_admin_case_tracking(uuid,uuid) from PUBLIC,anon;
grant execute on function public.lirep_admin_case_tracking(uuid,uuid) to authenticated;

-- Optional explicit case transitions, preserving the old database transition guard.
create or replace function public.lirep_admin_case_status_update(
  p_organization_id uuid,p_complaint_id uuid,p_status text,p_note text default null
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v public.complaints%rowtype;
begin
  if not public.lirep_admin_can_access(p_organization_id,true) then
    raise exception 'LIREP_STATUS_ACCESS_DENIED' using errcode='42501';
  end if;
  if p_status not in ('in_review','closed') or p_status is null then
    raise exception 'LIREP_STATUS_NOT_SUPPORTED' using errcode='22023';
  end if;
  select * into v from public.complaints
  where id=p_complaint_id and organization_id=p_organization_id for update;
  if v.id is null then raise exception 'LIREP_COMPLAINT_NOT_FOUND' using errcode='22023'; end if;
  if p_status='in_review' and v.status<>'submitted' then
    raise exception 'LIREP_STATUS_NOT_APPLICABLE' using errcode='22023';
  end if;
  if p_status='closed' and (v.status<>'responded' or v.responded_at is null) then
    raise exception 'LIREP_CLOSURE_REQUIRES_DELIVERY' using errcode='22023';
  end if;
  update public.complaints
  set status=p_status::public.lirep_complaint_status,
      closed_at=case when p_status='closed' then now() else closed_at end
  where id=p_complaint_id and organization_id=p_organization_id;
  if nullif(btrim(coalesce(p_note,'')),'') is not null then
    if length(btrim(p_note))>2000 then raise exception 'LIREP_STATUS_NOTE_TOO_LONG'; end if;
    insert into public.lirep_admin_case_entries(
      organization_id,complaint_id,kind,body,created_by
    ) values(p_organization_id,p_complaint_id,'internal_note',
      'Cambio de estado a '||p_status||': '||btrim(p_note),auth.uid());
  end if;
  return jsonb_build_object('ok',true,'status',p_status);
end $$;
revoke all on function public.lirep_admin_case_status_update(uuid,uuid,text,text) from PUBLIC,anon;
grant execute on function public.lirep_admin_case_status_update(uuid,uuid,text,text) to authenticated;

-- Consumer tracking: signed proof-of-possession (receipt token), no PII or notes.
-- Service role only; the public Worker validates inputs and performs rate-limited lookup.
create or replace function public.lirep_public_case_tracking(
  p_public_prefix text,p_public_code text,p_access_token uuid
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'LIREP_TRACKING_ACCESS_DENIED' using errcode='42501';
  end if;
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
end $$;
revoke all on function public.lirep_public_case_tracking(text,text,uuid) from PUBLIC,anon,authenticated;
grant execute on function public.lirep_public_case_tracking(text,text,uuid) to service_role;

-- Distinguish postal workflow from Resend statuses in the existing dashboard.
create or replace function public.lirep_admin_response_delivery_status(
  p_organization_id uuid,p_complaint_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
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
end $$;
revoke all on function public.lirep_admin_response_delivery_status(uuid,uuid) from PUBLIC,anon;
grant execute on function public.lirep_admin_response_delivery_status(uuid,uuid) to authenticated;
