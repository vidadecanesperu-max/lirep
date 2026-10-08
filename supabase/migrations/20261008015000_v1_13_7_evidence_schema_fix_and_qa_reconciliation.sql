-- LIREP V1.13.7 · completion compatible with actual communication_evidence schema.
-- The already-accepted QA email must be reconciled separately; never resend it.
create or replace function public.lirep_complete_receipt_email(
 p_queue_id uuid,p_success boolean,p_provider text default null,
 p_provider_message_id text default null,p_error text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_q public.complaint_delivery_queue%rowtype;
begin
 select * into v_q from public.complaint_delivery_queue
 where id=p_queue_id for update;
 if v_q.id is null then raise exception 'QUEUE_ITEM_NOT_FOUND'; end if;
 if v_q.status='sent' then return; end if;
 if v_q.status<>'processing' then raise exception 'QUEUE_NOT_PROCESSING'; end if;
 if p_success then
   if nullif(btrim(coalesce(p_provider_message_id,'')),'') is null then
     raise exception 'PROVIDER_MESSAGE_ID_REQUIRED';
   end if;
   insert into public.communication_evidence
     (organization_id,complaint_id,channel,destination,provider,
      external_message_id,delivery_status,sent_at,metadata)
   values
     (v_q.organization_id,v_q.complaint_id,'email',v_q.recipient,
      coalesce(p_provider,'resend'),p_provider_message_id,'sent',now(),
      jsonb_build_object('queue_id',v_q.id,'source','lirep_email_worker'))
   ;
   update public.complaint_delivery_queue
   set status='sent',provider=p_provider,
       provider_message_id=p_provider_message_id,
       sent_at=coalesce(sent_at,now()),last_error=null,
       locked_at=null,updated_at=now()
   where id=p_queue_id;
   update public.complaints
   set receipt_sent_at=coalesce(receipt_sent_at,now())
   where id=v_q.complaint_id;
 else
   update public.complaint_delivery_queue
   set status='failed',provider=p_provider,
       last_error=left(coalesce(p_error,'UNKNOWN_ERROR'),1000),
       next_attempt_at=now()+interval '15 minutes',
       locked_at=null,updated_at=now()
   where id=p_queue_id;
 end if;
end $$;
revoke all on function public.lirep_complete_receipt_email(uuid,boolean,text,text,text)
 from public,anon,authenticated;
grant execute on function public.lirep_complete_receipt_email(uuid,boolean,text,text,text)
 to service_role;
-- Reconcile the confirmed-delivered QA item without inventing a Resend message ID.
-- Record the verified inbox evidence as a separate audited source.
do $$
declare v_q public.complaint_delivery_queue%rowtype;
begin
 select * into v_q from public.complaint_delivery_queue
 where id='fc7d8539-775f-40ce-a8dd-87ebcd4071ce'::uuid for update;
 if v_q.id is null then raise exception 'QA_QUEUE_NOT_FOUND'; end if;
 if v_q.status='sent' then return; end if;
 if v_q.status<>'processing' or v_q.attempt_count<>1 then
   raise exception 'QA_QUEUE_STATE_CHANGED_REVIEW_REQUIRED';
 end if;
 if not exists(
   select 1 from public.organizations o
   where o.id=v_q.organization_id and o.public_prefix='LIREPQA1'
 ) then raise exception 'QA_ORGANIZATION_MISMATCH'; end if;
 insert into public.communication_evidence
   (organization_id,complaint_id,channel,destination,provider,
    external_message_id,delivery_status,sent_at,metadata)
 values
   (v_q.organization_id,v_q.complaint_id,'email',v_q.recipient,'resend',
    null,'sent',now(),
    jsonb_build_object('queue_id',v_q.id,'source','recipient_inbox_screenshot',
      'provider_message_id_unavailable',true,
      'note','Receipt verified by recipient screenshot; time is reconciliation time, not provider acceptance time'))
 ;
 update public.complaint_delivery_queue
 set status='sent',provider='resend',provider_message_id=null,
     sent_at=now(),locked_at=null,last_error=null,updated_at=now()
 where id=v_q.id;
 update public.complaints
 set receipt_sent_at=coalesce(receipt_sent_at,now())
 where id=v_q.complaint_id;
end $$;
select c.public_code,q.status,q.attempt_count,q.provider,
 q.provider_message_id is not null as provider_id_saved,
 (select count(*) from public.communication_evidence e
  where e.complaint_id=c.id) as evidence_count
from public.complaint_delivery_queue q
join public.complaints c on c.id=q.complaint_id
where q.id='fc7d8539-775f-40ce-a8dd-87ebcd4071ce'::uuid;
