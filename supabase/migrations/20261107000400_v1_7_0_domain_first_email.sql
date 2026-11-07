-- LIREP 1.7.0 | domain proof must precede outbound verification email.
BEGIN;
ALTER TABLE public.lirep_onboarding_requests
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_verify_domain(
  p_id uuid, p_status_hash text, p_challenge_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.lirep_onboarding_requests
    SET domain_verified_at=coalesce(domain_verified_at,now()),updated_at=now()
    WHERE id=p_id AND status_hash=p_status_hash AND challenge_hash=p_challenge_hash
      AND status='pending' AND expires_at>now()
    RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_verify_email(p_email_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.lirep_onboarding_requests
    SET email_verified_at=now(),email_hash=NULL,updated_at=now()
    WHERE email_hash=p_email_hash AND status='pending' AND expires_at>now()
      AND email_verified_at IS NULL AND domain_verified_at IS NOT NULL
    RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_set_email_token(
  p_id uuid, p_status_hash text, p_email_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_email_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  UPDATE public.lirep_onboarding_requests
    SET email_hash=p_email_hash,email_sent_at=now(),email_attempts=email_attempts+1,updated_at=now()
    WHERE id=p_id AND status_hash=p_status_hash AND status='pending'
      AND expires_at>now() AND domain_verified_at IS NOT NULL
      AND email_verified_at IS NULL AND email_attempts<3
      AND (email_sent_at IS NULL OR email_sent_at < now()-interval '2 minutes')
    RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.lirep_onboarding_set_email_token(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_set_email_token(uuid,text,text) TO service_role;
COMMIT;
