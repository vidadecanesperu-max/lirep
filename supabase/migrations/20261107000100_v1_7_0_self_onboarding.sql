-- LIREP v1.7.0 | RN-SELF-001 | onboarding autoservicio (STAGING FIRST).
-- Apply only after reviewing migrations; production must not be changed by CI.
BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS privacy_policy_url text;

CREATE UNIQUE INDEX IF NOT EXISTS lirep_domains_one_active_owner
  ON public.organization_domains (hostname) WHERE active = true;

CREATE TABLE IF NOT EXISTS public.lirep_onboarding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  ruc text NOT NULL,
  legal_name text NOT NULL,
  trade_name text,
  contact_email text NOT NULL,
  address text NOT NULL,
  district text NOT NULL,
  province text NOT NULL,
  department text NOT NULL,
  privacy_policy_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','expired','active')),
  status_hash text NOT NULL UNIQUE CHECK (status_hash ~ '^[a-f0-9]{64}$'),
  email_hash text CHECK (email_hash IS NULL OR email_hash ~ '^[a-f0-9]{64}$'),
  challenge_hash text NOT NULL CHECK (challenge_hash ~ '^[a-f0-9]{64}$'),
  email_verified_at timestamptz,
  domain_verified_at timestamptz,
  invitation_sent_at timestamptz,
  auth_user_id uuid,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lirep_onboarding_pending_domain
  ON public.lirep_onboarding_requests (domain) WHERE status IN ('pending','active');
CREATE UNIQUE INDEX IF NOT EXISTS lirep_onboarding_pending_ruc
  ON public.lirep_onboarding_requests (ruc) WHERE status IN ('pending','active');
CREATE UNIQUE INDEX IF NOT EXISTS lirep_onboarding_email_hash
  ON public.lirep_onboarding_requests (email_hash) WHERE email_hash IS NOT NULL;

ALTER TABLE public.lirep_onboarding_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lirep_onboarding_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_valid_ruc(p_ruc text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE v_sum integer := 0; v_digit integer; v_i integer;
  v_weights integer[] := ARRAY[5,4,3,2,7,6,5,4,3,2];
BEGIN
  IF p_ruc IS NULL OR p_ruc !~ '^[0-9]{11}$' OR left(p_ruc,2) NOT IN ('10','15','17','20') THEN
    RETURN false;
  END IF;
  FOR v_i IN 1..10 LOOP
    v_sum := v_sum + substring(p_ruc,v_i,1)::integer * v_weights[v_i];
  END LOOP;
  v_digit := 11 - mod(v_sum,11);
  IF v_digit = 10 THEN v_digit := 0; ELSIF v_digit = 11 THEN v_digit := 1; END IF;
  RETURN v_digit = right(p_ruc,1)::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_start(
  p_payload jsonb, p_status_hash text, p_email_hash text, p_challenge_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_domain text; v_ruc text; v_email text; v_id uuid;
  v_legal text; v_trade text; v_address text; v_district text;
  v_province text; v_department text; v_privacy text;
BEGIN
  IF jsonb_typeof(p_payload) <> 'object' OR
     p_status_hash !~ '^[a-f0-9]{64}$' OR
     p_email_hash !~ '^[a-f0-9]{64}$' OR
     p_challenge_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'LIREP_ONBOARDING_INVALID_INPUT';
  END IF;
  v_domain := lower(btrim(coalesce(p_payload->>'domain','')));
  v_ruc := btrim(coalesce(p_payload->>'ruc',''));
  v_email := lower(btrim(coalesce(p_payload->>'contact_email','')));
  v_legal := btrim(coalesce(p_payload->>'legal_name',''));
  v_trade := nullif(btrim(coalesce(p_payload->>'trade_name','')), '');
  v_address := btrim(coalesce(p_payload->>'address',''));
  v_district := btrim(coalesce(p_payload->>'district',''));
  v_province := btrim(coalesce(p_payload->>'province',''));
  v_department := btrim(coalesce(p_payload->>'department',''));
  v_privacy := btrim(coalesce(p_payload->>'privacy_policy_url',''));
  IF length(v_domain)>253 OR v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     OR v_domain ~ '(^|\.)(localhost|local|internal|test|invalid)$'
     OR NOT public.lirep_onboarding_valid_ruc(v_ruc)
     OR length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR length(v_legal) NOT BETWEEN 3 AND 200 OR length(coalesce(v_trade,''))>200
     OR length(v_address) NOT BETWEEN 5 AND 300
     OR length(v_district) NOT BETWEEN 2 AND 100
     OR length(v_province) NOT BETWEEN 2 AND 100
     OR length(v_department) NOT BETWEEN 2 AND 100
     OR length(v_privacy)>500 OR v_privacy !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'LIREP_ONBOARDING_INVALID_INPUT';
  END IF;
  -- Release expired reservations before checking uniqueness.
  UPDATE public.lirep_onboarding_requests
    SET status='expired', updated_at=now()
    WHERE status='pending' AND expires_at < now();
  IF EXISTS(SELECT 1 FROM public.organizations WHERE ruc=v_ruc) OR
     EXISTS(SELECT 1 FROM public.organization_domains WHERE hostname=v_domain AND active) THEN
    RAISE EXCEPTION 'LIREP_ONBOARDING_REVIEW_REQUIRED';
  END IF;
  INSERT INTO public.lirep_onboarding_requests
    (domain,ruc,legal_name,trade_name,contact_email,address,district,province,department,
     privacy_policy_url,status_hash,email_hash,challenge_hash)
  VALUES (v_domain,v_ruc,v_legal,v_trade,v_email,v_address,v_district,v_province,v_department,
          v_privacy,p_status_hash,p_email_hash,p_challenge_hash)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'expires_in_seconds',86400);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'LIREP_ONBOARDING_REVIEW_REQUIRED';
END;
$$;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_verify_email(p_email_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.lirep_onboarding_requests
    SET email_verified_at=now(), email_hash=NULL, updated_at=now()
    WHERE email_hash=p_email_hash AND status='pending' AND expires_at>now()
      AND email_verified_at IS NULL
    RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_status(p_id uuid, p_status_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v public.lirep_onboarding_requests%rowtype; v_prefix text;
BEGIN
  SELECT * INTO v FROM public.lirep_onboarding_requests
    WHERE id=p_id AND status_hash=p_status_hash;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v.organization_id IS NOT NULL THEN
    SELECT public_prefix INTO v_prefix FROM public.organizations WHERE id=v.organization_id;
  END IF;
  RETURN jsonb_build_object(
    'id',v.id,'domain',v.domain,'contact_email',v.contact_email,
    'email_verified',v.email_verified_at IS NOT NULL,
    'domain_verified',v.domain_verified_at IS NOT NULL,
    'invitation_sent',v.invitation_sent_at IS NOT NULL,
    'state',CASE WHEN v.status='pending' AND v.expires_at<=now() THEN 'expired' ELSE v.status END,
    'public_prefix',v_prefix,'expires_at',v.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_verify_domain(
  p_id uuid, p_status_hash text, p_challenge_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.lirep_onboarding_requests
    SET domain_verified_at=now(), updated_at=now()
    WHERE id=p_id AND status_hash=p_status_hash AND challenge_hash=p_challenge_hash
      AND status='pending' AND expires_at>now() AND email_verified_at IS NOT NULL
    RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_provision(
  p_id uuid, p_status_hash text, p_auth_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v public.lirep_onboarding_requests%rowtype;
  v_org uuid; v_est uuid; v_prefix text; v_auth_email text;
BEGIN
  SELECT * INTO v FROM public.lirep_onboarding_requests
    WHERE id=p_id AND status_hash=p_status_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIREP_ONBOARDING_NOT_FOUND'; END IF;
  IF v.status='active' AND v.auth_user_id=p_auth_user_id THEN
    SELECT public_prefix INTO v_prefix FROM public.organizations WHERE id=v.organization_id;
    RETURN jsonb_build_object('public_prefix',v_prefix,'already_active',true);
  END IF;
  IF v.status<>'pending' OR v.expires_at<=now()
     OR v.email_verified_at IS NULL OR v.domain_verified_at IS NULL THEN
    RAISE EXCEPTION 'LIREP_ONBOARDING_NOT_VERIFIED';
  END IF;
  SELECT lower(email) INTO v_auth_email FROM auth.users WHERE id=p_auth_user_id;
  IF v_auth_email IS NULL OR v_auth_email<>v.contact_email THEN
    RAISE EXCEPTION 'LIREP_ONBOARDING_AUTH_EMAIL_MISMATCH';
  END IF;
  IF EXISTS(SELECT 1 FROM public.organizations WHERE ruc=v.ruc) OR
     EXISTS(SELECT 1 FROM public.organization_domains WHERE hostname=v.domain AND active) THEN
    RAISE EXCEPTION 'LIREP_ONBOARDING_REVIEW_REQUIRED';
  END IF;
  INSERT INTO public.organizations
    (legal_name,trade_name,ruc,email,website,address,privacy_policy_url,active)
  VALUES (v.legal_name,v.trade_name,v.ruc,v.contact_email,'https://' || v.domain,
          v.address,v.privacy_policy_url,true)
  RETURNING id,public_prefix INTO v_org,v_prefix;
  INSERT INTO public.establishments
    (organization_id,code,name,address,district,province,department,is_virtual,active)
  VALUES (v_org,'SEDE001',coalesce(v.trade_name,v.legal_name),
          v.address,v.district,v.province,v.department,false,true)
  RETURNING id INTO v_est;
  INSERT INTO public.complaint_books (organization_id,establishment_id,code,active)
  VALUES (v_org,v_est,'LR001',true);
  INSERT INTO public.organization_domains (organization_id,hostname,active)
  VALUES (v_org,v.domain,true);
  INSERT INTO public.lirep_admin_memberships
    (user_id,organization_id,role,active)
  VALUES (p_auth_user_id,v_org,'company_admin',true);
  UPDATE public.lirep_onboarding_requests
    SET status='active',organization_id=v_org,auth_user_id=p_auth_user_id,updated_at=now()
    WHERE id=v.id;
  RETURN jsonb_build_object('public_prefix',v_prefix,'already_active',false);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'LIREP_ONBOARDING_REVIEW_REQUIRED';
END;
$$;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_mark_invited(p_id uuid, p_status_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.lirep_onboarding_requests SET invitation_sent_at=now(),updated_at=now()
  WHERE id=p_id AND status_hash=p_status_hash AND status='active'
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

-- Keep public form config tenant-specific, without exposing internal UUIDs.
CREATE OR REPLACE FUNCTION public.lirep_public_form_config(p_public_prefix text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_prefix text := upper(btrim(coalesce(p_public_prefix,'')));
  v_org public.organizations%rowtype; v_establishments jsonb;
BEGIN
  IF v_prefix !~ '^[A-Z0-9]{8}$' THEN RAISE EXCEPTION 'LIREP_INVALID_PUBLIC_PREFIX'; END IF;
  SELECT * INTO v_org FROM public.organizations
    WHERE public_prefix=v_prefix AND active=true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'LIREP_PUBLIC_FORM_NOT_AVAILABLE'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'code',e.code,'name',e.name,'is_virtual',e.is_virtual,
    'district',e.district,'province',e.province,'department',e.department,
    'books',coalesce((
      SELECT jsonb_agg(jsonb_build_object('code',b.code) ORDER BY b.code)
      FROM public.complaint_books b
      WHERE b.organization_id=v_org.id AND b.establishment_id=e.id AND b.active=true
    ),'[]'::jsonb)
  ) ORDER BY e.name,e.code),'[]'::jsonb)
  INTO v_establishments
  FROM public.establishments e WHERE e.organization_id=v_org.id AND e.active=true
    AND EXISTS(SELECT 1 FROM public.complaint_books b WHERE b.organization_id=v_org.id
      AND b.establishment_id=e.id AND b.active=true);
  RETURN jsonb_build_object(
    'organization',jsonb_build_object(
      'public_prefix',v_org.public_prefix,'legal_name',v_org.legal_name,
      'trade_name',v_org.trade_name,'privacy_policy_url',v_org.privacy_policy_url),
    'establishments',v_establishments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lirep_onboarding_valid_ruc(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lirep_onboarding_start(jsonb,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lirep_onboarding_verify_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lirep_onboarding_status(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lirep_onboarding_verify_domain(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lirep_onboarding_provision(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lirep_onboarding_mark_invited(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_start(jsonb,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_verify_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_status(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_verify_domain(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_provision(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_mark_invited(uuid,text) TO service_role;
COMMIT;
