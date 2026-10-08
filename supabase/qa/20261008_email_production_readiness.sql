-- LIREP QA-READINESS-012: read-only cross-tenant email readiness.
-- Never expose consumer PII or receipt tokens in reports.
select o.public_prefix,
       s.is_active as email_settings_active,
       count(q.id) filter (where q.status='pending') as pending,
       count(q.id) filter (where q.status='processing') as processing,
       count(q.id) filter (where q.status='failed') as failed,
       count(q.id) filter (where q.status='sent') as sent
from public.organizations o
left join public.organization_email_settings s on s.organization_id=o.id
left join public.complaint_delivery_queue q on q.organization_id=o.id
where o.public_prefix in ('LIREPQA1','VIDACANE')
group by o.public_prefix,s.is_active
order by o.public_prefix;

select c.public_code,q.status,q.attempt_count,
       q.provider_message_id is not null as provider_id_saved,
       q.sent_at is not null as sent_at_saved,
       c.receipt_sent_at is not null as complaint_updated,
       (select count(*) from public.communication_evidence e
        where e.complaint_id=c.id and e.channel='email'
          and e.delivery_status='sent') as sent_evidence_count
from public.complaints c
join public.complaint_delivery_queue q on q.complaint_id=c.id
where c.public_code in (
  'LIREPQA1-QA001-2026-00000001',
  'LIREPQA1-QA001-2026-00000002'
)
order by c.public_code;

select count(*) as duplicated_provider_identifiers
from (
  select provider_message_id
  from public.complaint_delivery_queue
  where provider_message_id is not null
  group by provider_message_id
  having count(*)>1
) duplicates;
