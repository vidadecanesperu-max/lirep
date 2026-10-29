-- ================================================================
-- LIREP ADMIN A6.1: detalles + notas internas + borradores
-- Requiere A1 + A2 + owner activo. No modifica registros públicos.
-- ================================================================
BEGIN;
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE public_prefix='VIDACANE') THEN
  RAISE EXCEPTION 'WRONG_LIREP_PROJECT';
 END IF;
 IF to_regclass('public.lirep_admin_platform_owners') IS NULL THEN
  RAISE EXCEPTION 'LIREP_ADMIN_A2_REQUIRED';
 END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS public.lirep_admin_case_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 complaint_id uuid NOT NULL REFERENCES public.complaints(id),
 kind text NOT NULL CHECK(kind IN ('internal_note','response_draft')),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lirep_admin_case_entries_case_idx
 ON public.lirep_admin_case_entries (organization_id,complaint_id,created_at DESC);
ALTER TABLE public.lirep_admin_case_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lirep_admin_case_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.lirep_admin_case_entries TO service_role;

-- Called internally by definer RPCs, never directly from anonymous clients.
CREATE OR REPLACE FUNCTION public.lirep_admin_can_access(
 p_organization_id uuid, p_write boolean DEFAULT false
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT (select auth.uid()) IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=p_organization_id AND o.active)
  AND (
    public.lirep_admin_is_owner()
    OR EXISTS (
      SELECT 1 FROM public.lirep_admin_memberships m
      WHERE m.user_id=(select auth.uid())
        AND m.organization_id=p_organization_id AND m.active
        AND (NOT p_write OR m.role IN ('company_admin','operator'))
    )
  );
$f$;

CREATE OR REPLACE FUNCTION public.lirep_admin_case_detail(
 p_organization_id uuid,p_complaint_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v_result jsonb;
BEGIN
 IF NOT public.lirep_admin_can_access(p_organization_id,false) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object(
  'id',c.id,'public_code',c.public_code,'complaint_type',c.complaint_type,
  'status',c.status,'submitted_at',c.submitted_at,'response_due_at',c.response_due_at,
  'product_service_type',c.product_service_type,
  'product_service_description',c.product_service_description,
  'amount',c.amount,'detail',c.detail,'consumer_request',c.consumer_request,
  'preferred_response_channel',c.preferred_response_channel,
  'establishment',e.name,
  'consumer',jsonb_build_object(
    'first_names',co.first_names,'last_names',co.last_names,
    'document_type',co.document_type,'document_number',co.document_number,
    'email',co.email,'phone',co.phone,'address',co.address,
    'is_minor',co.is_minor,
    'representative_first_names',co.representative_first_names,
    'representative_last_names',co.representative_last_names
  )
 ) INTO v_result
 FROM public.complaints c
 JOIN public.consumers co ON co.id=c.consumer_id AND co.organization_id=c.organization_id
 LEFT JOIN public.establishments e ON e.id=c.establishment_id AND e.organization_id=c.organization_id
 WHERE c.organization_id=p_organization_id AND c.id=p_complaint_id;
 IF v_result IS NULL THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='22023'; END IF;
 RETURN v_result;
END;
$f$;

CREATE OR REPLACE FUNCTION public.lirep_admin_case_entries_list(
 p_organization_id uuid,p_complaint_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v_result jsonb;
BEGIN
 IF NOT public.lirep_admin_can_access(p_organization_id,false) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.complaints c WHERE c.id=p_complaint_id AND c.organization_id=p_organization_id) THEN
  RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',n.id,'kind',n.kind,'body',n.body,'created_at',n.created_at,'created_by',n.created_by
  ) ORDER BY n.created_at DESC),'[]'::jsonb)
 INTO v_result
 FROM public.lirep_admin_case_entries n
 WHERE n.organization_id=p_organization_id AND n.complaint_id=p_complaint_id;
 RETURN v_result;
END;
$f$;

CREATE OR REPLACE FUNCTION public.lirep_admin_case_add_entry(
 p_organization_id uuid,p_complaint_id uuid,p_kind text,p_body text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v_entry uuid;
BEGIN
 IF NOT public.lirep_admin_can_access(p_organization_id,true) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE='42501';
 END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('internal_note','response_draft') THEN
  RAISE EXCEPTION 'INVALID_ENTRY_KIND' USING ERRCODE='22023';
 END IF;
 IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 10000 THEN
  RAISE EXCEPTION 'INVALID_ENTRY_LENGTH' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.complaints c
  WHERE c.id=p_complaint_id AND c.organization_id=p_organization_id
 ) THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='22023'; END IF;
 INSERT INTO public.lirep_admin_case_entries
 (organization_id,complaint_id,kind,body,created_by)
 VALUES(p_organization_id,p_complaint_id,p_kind,btrim(p_body),(select auth.uid()))
 RETURNING id INTO v_entry;
 RETURN jsonb_build_object('ok',true,'entry_id',v_entry,'status','saved_internal_only');
END;
$f$;

REVOKE ALL ON FUNCTION public.lirep_admin_can_access(uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lirep_admin_case_detail(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lirep_admin_case_entries_list(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lirep_admin_case_add_entry(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_can_access(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_case_detail(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_case_entries_list(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_case_add_entry(uuid,uuid,text,text) TO authenticated;
COMMIT;
SELECT 'LIREP ADMIN A6.1' AS componente,
 CASE WHEN to_regclass('public.lirep_admin_case_entries') IS NOT NULL
  AND to_regprocedure('public.lirep_admin_case_detail(uuid,uuid)') IS NOT NULL
  AND to_regprocedure('public.lirep_admin_case_add_entry(uuid,uuid,text,text)') IS NOT NULL
 THEN 'PASS' ELSE 'FAIL' END AS resultado;
