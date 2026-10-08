-- LIREP V1.13.7 · atomic evidence and safe completion
-- Does not resend email. Protects accepted deliveries from duplicate retries.
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
   update public.complaint_delivery_queue
   set status='sent',provider=p_provider,
       provider_message_id=p_provider_message_id,
       sent_at=coalesce(sent_at,now()),last_error=null,
       locked_at=null,updated_at=now()
   where id=p_queue_id;
   update public.complaints
   set receipt_sent_at=coalesce(receipt_sent_at,now())
   where id=v_q.complaint_id;
   -- Evidence is recorded by the separate validated evidence adapter.
   -- No blind insert into an unverified table schema.
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
-- Inspect evidence columns before adding evidence adapter.
select column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name='communication_evidence'
order by ordinal_position;
