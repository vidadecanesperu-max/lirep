-- LIREP v1.7.0 | Self-service reconnection to existing organizations.
-- STAGING FIRST. Requires domain challenge and confirmed company_admin email.
BEGIN;

CREATE OR REPLACE FUNCTION public.lirep_onboarding_start(
  p_payload jsonb, p_status_hash text, p_email_hash text, p_challenge_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_domain text; v_ruc text; v_email text; v_id uuid;
  v_legal text; v_trade text; v_address text; v_district text;
  v_province text; v_department text; v_privacy text;
  v_org_id uuid; v_domain_org uuid;
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
  UPDATE public.lirep_onboarding_requests
    SET status='expired',updated_at=now()
    WHERE status='pending' AND expires_at<now();
  SELECT id INTO v_org_id FROM public.organizations WHERE ruc=v_ruc AND active=true;
  SELECT organization_id INTO v_domain_org
    FROM public.organization_domains WHERE hostname=v_domain AND active=true;
  IF v_domain_org IS NOT NULL AND (v_org_id IS NULL OR v_org_id<>v_domain_org) THEN
    RAISE EXCEPTION 'LIREP_ONBOARDING_REVIEW_REQUIRED';
  END IF;
  IF v_org_id IS NOT NULL THEN
    -- Existing tenants may self-link ONLY through a confirmed existing company admin.
    IF NOT EXISTS (
      SELECT 1 FROM public.lirep_admin_memberships m
      JOIN auth.users u ON u.id=m.user_id
      WHERE m.organization_id=v_org_id AND m.active=true AND m.role='company_admin'
        AND lower(u.email)=v_email AND u.email_confirmed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'LIREP_ONBOARDING_REVIEW_REQUIRED';
    END IF;
  ELSIF EXISTS(SELECT 1 FROM public.organizations WHERE ruc=v_ruc) THEN
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

CREATE OR REPLACE FUNCTION public.lirep_onboarding_provision(
  p_id uuid, p_status_hash text, p_auth_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v public.lirep_onboarding_requests%rowtype;
  v_org uuid; v_est uuid; v_prefix text; v_auth_email text; v_domain_owner uuid;
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
  SELECT id INTO v_org FROM public.organizations
    WHERE ruc=v.ruc AND active=true FOR UPDATE;
  SELECT organization_id INTO v_domain_owner FROM public.organization_domains
    WHERE hostname=v.domain AND active=true;
  IF v_domain_owner IS NOT NULL AND (v_org IS NULL OR v_domain_owner<>v_org) THEN
    RAISE EXCEPTION 'LIREP_ONBOARDING_REVIEW_REQUIRED';
  END IF;
  IF v_org IS NOT NULL THEN
    -- Revalidate at provisioning time: no account takeover or cross-company reassignment.
    IF NOT EXISTS(
      SELECT 1 FROM public.lirep_admin_memberships m JOIN auth.users u ON u.id=m.user_id
      WHERE m.organization_id=v_org AND m.user_id=p_auth_user_id
        AND m.role='company_admin' AND m.active=true AND u.email_confirmed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'LIREP_ONBOARDING_REVIEW_REQUIRED';
    END IF;
    IF v_domain_owner IS NULL THEN
      INSERT INTO public.organization_domains(organization_id,hostname,active)
      VALUES (v_org,v.domain,true);
    END IF;
    UPDATE public.organizations
      SET privacy_policy_url=coalesce(nullif(privacy_policy_url,''),v.privacy_policy_url)
      WHERE id=v_org;
    SELECT public_prefix INTO v_prefix FROM public.organizations WHERE id=v_org;
    UPDATE public.lirep_onboarding_requests
      SET status='active',organization_id=v_org,auth_user_id=p_auth_user_id,updated_at=now()
      WHERE id=v.id;
    RETURN jsonb_build_object('public_prefix',v_prefix,'already_active',false,'linked_existing',true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.organizations WHERE ruc=v.ruc) THEN
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
  RETURN jsonb_build_object('public_prefix',v_prefix,'already_active',false,'linked_existing',false);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'LIREP_ONBOARDING_REVIEW_REQUIRED';
END;
$$;

REVOKE ALL ON FUNCTION public.lirep_onboarding_start(jsonb,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lirep_onboarding_provision(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_start(jsonb,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lirep_onboarding_provision(uuid,text,uuid) TO service_role;
COMMIT;
