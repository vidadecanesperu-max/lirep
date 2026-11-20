-- LIREP QA249 | Internal 15-calendar-day closure, recorded disagreement, tenant isolation.
-- The Peruvian 15 BUSINESS day legal period applies to PROVIDER RESPONSE.
-- This 15 CALENDAR day period is only an internal administrative closing policy.
-- It does not waive, suspend, or extinguish the consumer's legal rights.

CREATE TABLE IF NOT EXISTS public.lirep_case_disagreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  complaint_id uuid NOT NULL REFERENCES public.complaints(id),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolution_note text,
  CONSTRAINT lirep_disagreement_resolution_check CHECK (
    (status='open' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status='resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
        AND char_length(btrim(coalesce(resolution_note,''))) BETWEEN 10 AND 4000)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS lirep_one_open_disagreement_per_case
  ON public.lirep_case_disagreements(organization_id,complaint_id)
  WHERE status='open';
CREATE INDEX IF NOT EXISTS lirep_case_disagreements_org_idx
  ON public.lirep_case_disagreements(organization_id,complaint_id,created_at DESC);
ALTER TABLE public.lirep_case_disagreements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lirep_case_disagreements FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.lirep_admin_disagreement_record(
  p_organization_id uuid,p_complaint_id uuid,p_description text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_id uuid; v_count integer;
BEGIN
  IF NOT public.lirep_admin_can_access(p_organization_id,true) THEN
    RAISE EXCEPTION 'LIREP_DISAGREEMENT_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  IF char_length(btrim(coalesce(p_description,''))) NOT BETWEEN 10 AND 4000 THEN
    RAISE EXCEPTION 'LIREP_DISAGREEMENT_TEXT_INVALID' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.id=p_complaint_id AND c.organization_id=p_organization_id
      AND c.status IN ('responded','closed')
      AND EXISTS(
        SELECT 1 FROM public.lirep_admin_official_responses r
        WHERE r.organization_id=c.organization_id AND r.complaint_id=c.id AND r.status='approved')
  ) THEN
    RAISE EXCEPTION 'LIREP_DISAGREEMENT_CASE_NOT_ELIGIBLE' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.lirep_case_disagreements(
    organization_id,complaint_id,description,created_by
  ) VALUES(p_organization_id,p_complaint_id,btrim(p_description),(SELECT auth.uid()))
  ON CONFLICT (organization_id,complaint_id) WHERE status='open'
  DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.lirep_case_disagreements
    WHERE organization_id=p_organization_id AND complaint_id=p_complaint_id
      AND status='open';
  END IF;
  SELECT count(*) INTO v_count FROM public.lirep_case_disagreements
    WHERE organization_id=p_organization_id AND complaint_id=p_complaint_id AND status='open';
  RETURN jsonb_build_object('ok',true,'id',v_id,'status','open','open_count',v_count);
END $fn$;

CREATE OR REPLACE FUNCTION public.lirep_admin_disagreement_resolve(
  p_organization_id uuid,p_disagreement_id uuid,p_resolution_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT public.lirep_admin_can_access(p_organization_id,true) THEN
    RAISE EXCEPTION 'LIREP_DISAGREEMENT_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  IF char_length(btrim(coalesce(p_resolution_note,''))) NOT BETWEEN 10 AND 4000 THEN
    RAISE EXCEPTION 'LIREP_DISAGREEMENT_RESOLUTION_REQUIRED' USING ERRCODE='22023';
  END IF;
  UPDATE public.lirep_case_disagreements d
  SET status='resolved',resolved_at=now(),resolved_by=(SELECT auth.uid()),
      resolution_note=btrim(p_resolution_note)
  WHERE d.id=p_disagreement_id AND d.organization_id=p_organization_id AND d.status='open'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'LIREP_DISAGREEMENT_NOT_OPEN' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('ok',true,'id',v_id,'status','resolved');
END $fn$;

CREATE OR REPLACE FUNCTION public.lirep_admin_disagreements_list(
  p_organization_id uuid,p_complaint_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v jsonb;
BEGIN
  IF NOT public.lirep_admin_can_access(p_organization_id,false) THEN
    RAISE EXCEPTION 'LIREP_DISAGREEMENT_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.complaints
    WHERE id=p_complaint_id AND organization_id=p_organization_id) THEN
    RAISE EXCEPTION 'LIREP_COMPLAINT_NOT_FOUND' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',d.id,'status',d.status,'description',d.description,
    'created_at',d.created_at,'resolved_at',d.resolved_at,
    'resolution_note',d.resolution_note
  ) ORDER BY d.created_at DESC),'[]'::jsonb) INTO v
  FROM public.lirep_case_disagreements d
  WHERE d.organization_id=p_organization_id AND d.complaint_id=p_complaint_id;
  RETURN v;
END $fn$;

CREATE OR REPLACE FUNCTION public.lirep_admin_disagreements_summary(
  p_organization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v jsonb;
BEGIN
  IF NOT public.lirep_admin_can_access(p_organization_id,false) THEN
    RAISE EXCEPTION 'LIREP_DISAGREEMENT_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'closed',count(*) FILTER (WHERE c.status='closed'),
    'appealed',count(*) FILTER(WHERE EXISTS (
      SELECT 1 FROM public.lirep_case_disagreements d
      WHERE d.organization_id=c.organization_id AND d.complaint_id=c.id)),
    'appeals_pending',count(*) FILTER(WHERE EXISTS(
      SELECT 1 FROM public.lirep_case_disagreements d
      WHERE d.organization_id=c.organization_id AND d.complaint_id=c.id AND d.status='open'))
  ) INTO v FROM public.complaints c WHERE c.organization_id=p_organization_id;
  RETURN v;
END $fn$;

-- Service-only eligibility: require response APPROVED, an accepted message with
-- VERIFIED reception, at least 15 full CALENDAR days since its send timestamp,
-- and NO currently open disagreement. Postal evidence must also be delivered.
CREATE OR REPLACE FUNCTION public.lirep_internal_ready_to_close(
  p_organization_id uuid,p_complaint_id uuid,p_reference_time timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
SELECT EXISTS(
  SELECT 1 FROM public.complaints c
  WHERE c.id=p_complaint_id AND c.organization_id=p_organization_id
    AND c.status='responded' AND c.responded_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.lirep_case_disagreements a
      WHERE a.complaint_id=c.id AND a.organization_id=c.organization_id AND a.status='open')
    AND EXISTS(
      SELECT 1 FROM public.lirep_admin_official_responses r
      JOIN public.communication_evidence e
        ON e.organization_id=r.organization_id AND e.complaint_id=r.complaint_id
       AND e.metadata->>'kind'='official_response'
       AND e.metadata->>'response_id'=r.id::text
      WHERE r.organization_id=c.organization_id AND r.complaint_id=c.id
        AND r.status='approved'
        AND e.delivery_status='delivered' AND e.delivered_at IS NOT NULL
        AND e.sent_at IS NOT NULL AND e.sent_at <= p_reference_time - INTERVAL '15 days'
        AND (
          (e.channel='email' AND EXISTS(
            SELECT 1 FROM public.lirep_admin_response_delivery d
            WHERE d.organization_id=e.organization_id AND d.complaint_id=e.complaint_id
              AND d.response_id=r.id AND d.status='sent'
              AND d.provider_message_id=e.external_message_id))
          OR (e.channel='postal' AND nullif(btrim(coalesce(e.external_message_id,'')),'') IS NOT NULL)
        )
    )
);
$fn$;

-- No early manual closure; automatic processor and permitted manual closure
-- after the same 15-day policy use the identical eligibility function.
CREATE OR REPLACE FUNCTION public.lirep_admin_case_status_update(
 p_organization_id uuid,p_complaint_id uuid,p_status text,p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v public.complaints%rowtype;
BEGIN
 IF NOT public.lirep_admin_can_access(p_organization_id,true) THEN
   RAISE EXCEPTION 'LIREP_STATUS_ACCESS_DENIED' USING ERRCODE='42501';
 END IF;
 IF p_status NOT IN ('in_review','closed') OR p_status IS NULL THEN
   RAISE EXCEPTION 'LIREP_STATUS_NOT_SUPPORTED' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v FROM public.complaints
 WHERE id=p_complaint_id AND organization_id=p_organization_id FOR UPDATE;
 IF v.id IS NULL THEN RAISE EXCEPTION 'LIREP_COMPLAINT_NOT_FOUND' USING ERRCODE='22023'; END IF;
 IF p_status='in_review' AND v.status<>'submitted' THEN
   RAISE EXCEPTION 'LIREP_STATUS_NOT_APPLICABLE' USING ERRCODE='22023';
 END IF;
 IF p_status='closed' AND NOT public.lirep_internal_ready_to_close(
    p_organization_id,p_complaint_id,now()) THEN
   RAISE EXCEPTION 'LIREP_CLOSURE_PENDING_15_DAYS_OR_DISAGREEMENT' USING ERRCODE='22023';
 END IF;
 UPDATE public.complaints
 SET status=p_status::public.lirep_complaint_status,
 closed_at=CASE WHEN p_status='closed' THEN now() ELSE closed_at END
 WHERE id=p_complaint_id AND organization_id=p_organization_id;
 IF nullif(btrim(coalesce(p_note,'')),'') IS NOT NULL THEN
   IF length(btrim(p_note))>2000 THEN RAISE EXCEPTION 'LIREP_STATUS_NOTE_TOO_LONG'; END IF;
   INSERT INTO public.lirep_admin_case_entries(
     organization_id,complaint_id,kind,body,created_by)
   VALUES(p_organization_id,p_complaint_id,'internal_note',
     'Cambio de estado a '||p_status||': '||btrim(p_note),auth.uid());
 END IF;
 RETURN jsonb_build_object('ok',true,'status',p_status);
END $fn$;

CREATE OR REPLACE FUNCTION public.lirep_internal_auto_close_due(
 p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v record; v_count integer:=0; v_limit integer:=LEAST(100,GREATEST(1,COALESCE(p_limit,50)));
BEGIN
 -- No JWT/client access; execute privilege is service_role-only.
 FOR v IN
   SELECT c.id,c.organization_id
   FROM public.complaints c
   WHERE c.status='responded'
     AND public.lirep_internal_ready_to_close(c.organization_id,c.id,now())
   ORDER BY c.responded_at,c.id
   LIMIT v_limit FOR UPDATE OF c SKIP LOCKED
 LOOP
   -- Re-evaluate under the row lock, including any just-registered disagreement.
   IF public.lirep_internal_ready_to_close(v.organization_id,v.id,now()) THEN
     UPDATE public.complaints
       SET status='closed',closed_at=now()
     WHERE id=v.id AND organization_id=v.organization_id AND status='responded';
     IF FOUND THEN
       v_count:=v_count+1;
       UPDATE public.complaint_status_history h
       SET note='Cierre administrativo automático tras 15 días calendario desde el envío acreditado, sin disconformidad pendiente'
       WHERE h.complaint_id=v.id AND h.organization_id=v.organization_id
         AND h.new_status='closed' AND h.changed_by IS NULL AND h.note IS NULL;
     END IF;
   END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'closed_count',v_count);
END $fn$;

REVOKE ALL ON FUNCTION public.lirep_admin_disagreement_record(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.lirep_admin_disagreement_resolve(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.lirep_admin_disagreements_list(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.lirep_admin_disagreements_summary(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lirep_admin_disagreement_record(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_disagreement_resolve(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_disagreements_list(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_disagreements_summary(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.lirep_internal_ready_to_close(uuid,uuid,timestamptz)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lirep_internal_auto_close_due(integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_internal_auto_close_due(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.lirep_internal_ready_to_close(uuid,uuid,timestamptz) TO service_role;
