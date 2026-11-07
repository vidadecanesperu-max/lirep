-- LIREP v1.7.1 | Limit unverified reservations to 15 minutes.
-- A verified domain may keep its request for 24 hours to confirm email.
BEGIN;
CREATE OR REPLACE FUNCTION public.lirep_onboarding_verify_domain(
  p_id uuid, p_status_hash text, p_challenge_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.lirep_onboarding_requests
    SET domain_verified_at=now(),expires_at=now()+interval '24 hours',updated_at=now()
    WHERE id=p_id AND status_hash=p_status_hash AND challenge_hash=p_challenge_hash
      AND status='pending' AND expires_at>now() AND domain_verified_at IS NULL
    RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

-- Default affects newly created requests only.
ALTER TABLE public.lirep_onboarding_requests
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '15 minutes');

-- Existing unverified requests remain untouched; no customer data changed.
CREATE OR REPLACE FUNCTION public.lirep_onboarding_reservation_window(p_id uuid,p_status_hash text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT greatest(0,extract(epoch FROM (expires_at-now()))::integer)
  FROM public.lirep_onboarding_requests
  WHERE id=p_id AND status_hash=p_status_hash;
$$;
REVOKE ALL ON FUNCTION public.lirep_onboarding_reservation_window(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_reservation_window(uuid,text) TO service_role;
COMMIT;
