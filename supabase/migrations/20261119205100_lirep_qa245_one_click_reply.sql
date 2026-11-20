-- QA245: one-click admin answer is an atomic draft, submission and approval.
-- If a matching pending/approved answer exists, reuse it and never create another.
-- Delivery itself is handled by the same idempotent email Worker.
CREATE OR REPLACE FUNCTION public.lirep_admin_reply_and_approve(
  p_organization_id uuid,
  p_complaint_id uuid,
  p_body text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_case public.complaints%rowtype;
  v_existing public.lirep_admin_official_responses%rowtype;
  v_entry jsonb;
  v_submitted jsonb;
  v_id uuid;
  v_body text;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (
    public.lirep_admin_is_owner()
    OR EXISTS (
      SELECT 1 FROM public.lirep_admin_memberships m
      WHERE m.user_id=(SELECT auth.uid())
        AND m.organization_id=p_organization_id
        AND m.active=true AND m.role='company_admin'
    )
  ) THEN
    RAISE EXCEPTION 'LIREP_ADMIN_REPLY_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;

  v_body:=btrim(coalesce(p_body,''));
  IF length(v_body) NOT BETWEEN 10 AND 10000 THEN
    RAISE EXCEPTION 'LIREP_REPLY_LENGTH_INVALID' USING ERRCODE='22023';
  END IF;

  SELECT c.* INTO v_case
  FROM public.complaints c
  JOIN public.organizations o ON o.id=c.organization_id AND o.active=true
  WHERE c.organization_id=p_organization_id AND c.id=p_complaint_id
  FOR UPDATE OF c;
  IF v_case.id IS NULL THEN
    RAISE EXCEPTION 'LIREP_CASE_NOT_FOUND' USING ERRCODE='22023';
  END IF;
  IF v_case.status='closed' THEN
    RAISE EXCEPTION 'LIREP_CASE_ALREADY_CLOSED' USING ERRCODE='22023';
  END IF;

  SELECT r.* INTO v_existing
  FROM public.lirep_admin_official_responses r
  WHERE r.organization_id=p_organization_id
    AND r.complaint_id=p_complaint_id
    AND r.status IN ('approved','pending_approval')
  ORDER BY r.submitted_at DESC,r.id
  LIMIT 1 FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.body IS DISTINCT FROM v_body THEN
      RAISE EXCEPTION 'LIREP_OFFICIAL_RESPONSE_ALREADY_EXISTS' USING ERRCODE='23505';
    END IF;
    IF v_existing.status='pending_approval' THEN
      PERFORM public.lirep_admin_a10_review(
        p_organization_id,v_existing.id,true,null
      );
    END IF;
    RETURN jsonb_build_object('ok',true,'response_id',v_existing.id,
      'status','approved','reused',true);
  END IF;

  v_entry:=public.lirep_admin_case_add_entry(
    p_organization_id,p_complaint_id,'response_draft',v_body
  );
  v_id:=(v_entry->>'entry_id')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'LIREP_DRAFT_SAVE_FAILED' USING ERRCODE='22023';
  END IF;
  v_submitted:=public.lirep_admin_a10_submit(
    p_organization_id,p_complaint_id,v_id
  );
  v_id:=(v_submitted->>'response_id')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'LIREP_REPLY_SUBMIT_FAILED' USING ERRCODE='22023';
  END IF;
  PERFORM public.lirep_admin_a10_review(
    p_organization_id,v_id,true,null
  );
  RETURN jsonb_build_object('ok',true,'response_id',v_id,
    'status','approved','reused',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.lirep_admin_reply_and_approve(uuid,uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lirep_admin_reply_and_approve(uuid,uuid,text)
  TO authenticated;
