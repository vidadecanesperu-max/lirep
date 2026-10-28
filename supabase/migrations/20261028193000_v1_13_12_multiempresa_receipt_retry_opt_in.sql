-- LIREP: opt-in multiempresa receipt retry discovery.
-- Keeps lirep_next_pending_receipt_id() unchanged for the QA-only scheduler.
-- Does not send or claim queue items. service_role only.
CREATE OR REPLACE FUNCTION public.lirep_next_pending_receipt_id_multiempresa()
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $lirep$
  SELECT q.id
  FROM public.complaint_delivery_queue q
  JOIN public.organizations o ON o.id = q.organization_id
  JOIN public.organization_email_settings s
    ON s.organization_id = q.organization_id
   AND s.is_active = true
  WHERE q.status IN ('pending', 'failed')
    AND q.next_attempt_at <= now()
    AND q.attempt_count < 5
    AND o.public_prefix IS NOT NULL
    AND s.from_email IS NOT NULL
    AND btrim(s.from_email) <> ''
  ORDER BY q.created_at, q.id
  LIMIT 1;
$lirep$;

REVOKE ALL ON FUNCTION public.lirep_next_pending_receipt_id_multiempresa()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_next_pending_receipt_id_multiempresa()
  TO service_role;
