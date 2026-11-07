-- LIREP v1.7.0 | cancel/retry of pending onboarding without locking a tenant.
BEGIN;
CREATE OR REPLACE FUNCTION public.lirep_onboarding_cancel(p_id uuid, p_status_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.lirep_onboarding_requests
    SET status='expired',email_hash=NULL,updated_at=now()
    WHERE id=p_id AND status_hash=p_status_hash AND status='pending'
    RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.lirep_onboarding_cancel(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_cancel(uuid,text) TO service_role;
COMMIT;
