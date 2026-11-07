-- LIREP v1.7.1 | PRODUCTION RELEASE GATE (NOT APPLIED).
-- Production currently restricts notification claims to LIREPQA1.
-- This replaces the QA-only filter with organization-scoped multi-tenant claims.
-- Review queue snapshot and email settings before applying in production.
BEGIN;
CREATE OR REPLACE FUNCTION public.lirep_admin_a9_claim()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_q public.lirep_admin_notification_queue%rowtype; v_result jsonb;
BEGIN
  SELECT q.* INTO v_q
  FROM public.lirep_admin_notification_queue q
  JOIN public.organizations o ON o.id=q.organization_id AND o.active=true
  JOIN public.lirep_admin_notification_settings s
    ON s.organization_id=q.organization_id AND s.enabled=true
  JOIN public.organization_email_settings e
    ON e.organization_id=q.organization_id AND e.is_active=true
  WHERE q.status IN ('pending','failed') AND q.next_attempt_at<=now()
    AND q.attempt_count<3 AND q.recipient=ANY(s.recipients)
    AND nullif(btrim(e.from_email),'') IS NOT NULL
  ORDER BY q.created_at,q.id LIMIT 1 FOR UPDATE OF q SKIP LOCKED;
  IF v_q.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.lirep_admin_notification_queue
    SET status='processing',locked_at=now(),attempt_count=attempt_count+1,updated_at=now()
    WHERE id=v_q.id;
  SELECT jsonb_build_object(
    'queue_id',v_q.id,'recipient',v_q.recipient,'public_code',c.public_code,
    'public_prefix',o.public_prefix,
    'establishment',coalesce(to_jsonb(c)->>'establishment',''),
    'response_due_at',c.response_due_at,'from_name',e.from_name,'from_email',e.from_email
  ) INTO v_result
  FROM public.complaints c
  JOIN public.organizations o ON o.id=c.organization_id AND o.active=true
  JOIN public.organization_email_settings e
    ON e.organization_id=c.organization_id AND e.is_active=true
  WHERE c.id=v_q.complaint_id AND c.organization_id=v_q.organization_id;
  IF v_result IS NULL THEN
    UPDATE public.lirep_admin_notification_queue
      SET status='held',last_error='CLAIM_DATA_MISSING',locked_at=null,updated_at=now()
      WHERE id=v_q.id;
    RETURN NULL;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.lirep_admin_a9_claim() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_a9_claim() TO service_role;
COMMIT;
