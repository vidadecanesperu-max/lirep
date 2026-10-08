-- LIREP QA-FUNCTIONAL-023: verify the newest QA submission after security hardening.
-- Read only. Does not return consumer PII, email addresses or receipt tokens.
with last_qa as (
  select c.id,c.public_code,c.submitted_at
  from public.complaints c
  join public.organizations o on o.id=c.organization_id
  where o.public_prefix='LIREPQA1'
  order by c.submitted_at desc,c.id desc
  limit 1
)
select c.public_code,
       c.submitted_at,
       coalesce(q.status,'NO_QUEUE') as email_status,
       coalesce(q.attempt_count,0) as email_attempts,
       q.provider_message_id is not null as resend_id_saved,
       q.sent_at is not null as sent_at_saved,
       (select count(*) from public.communication_evidence e
        where e.complaint_id=c.id and e.channel='email'
          and e.delivery_status='sent') as sent_evidence_count,
       (select count(*) from public.complaint_receipt_tokens t
        where t.complaint_id=c.id) as receipt_token_count
from last_qa c
left join public.complaint_delivery_queue q on q.complaint_id=c.id
order by c.submitted_at desc;
