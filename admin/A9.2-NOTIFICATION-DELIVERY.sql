-- LIREP ADMIN A9.2: service-role-only delivery lease & completion; no email sent by SQL.
BEGIN;
CREATE OR REPLACE FUNCTION public.lirep_admin_a9_claim()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_q public.lirep_admin_notification_queue%rowtype;
v_result jsonb;
BEGIN
 SELECT q.* INTO v_q
 FROM public.lirep_admin_notification_queue q
 JOIN public.lirep_admin_notification_settings s
   ON s.organization_id=q.organization_id AND s.enabled=true
 JOIN public.organization_email_settings e
   ON e.organization_id=q.organization_id AND e.is_active=true
 WHERE q.status IN ('pending','failed') AND q.next_attempt_at<=now()
   AND q.attempt_count<3
   AND q.recipient=ANY(s.recipients)
 ORDER BY q.created_at,q.id
 LIMIT 1 FOR UPDATE OF q SKIP LOCKED;
 IF v_q.id IS NULL THEN RETURN NULL; END IF;
 UPDATE public.lirep_admin_notification_queue
 SET status='processing',locked_at=now(),attempt_count=attempt_count+1,updated_at=now()
 WHERE id=v_q.id;
 SELECT jsonb_build_object(
  'queue_id',v_q.id,'recipient',v_q.recipient,
  'public_code',c.public_code,'public_prefix',o.public_prefix,
  'establishment',coalesce(to_jsonb(c)->>'establishment',''),
  'response_due_at',c.response_due_at,
  'from_name',e.from_name,'from_email',e.from_email)
 INTO v_result
 FROM public.complaints c
 JOIN public.organizations o ON o.id=c.organization_id
 JOIN public.organization_email_settings e ON e.organization_id=c.organization_id
 WHERE c.id=v_q.complaint_id AND c.organization_id=v_q.organization_id;
 IF v_result IS NULL THEN
   UPDATE public.lirep_admin_notification_queue
   SET status='held',last_error='CLAIM_DATA_MISSING',
       locked_at=null,updated_at=now() WHERE id=v_q.id;
   RETURN NULL;
 END IF;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.lirep_admin_a9_claim() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_a9_claim() TO service_role;

CREATE OR REPLACE FUNCTION public.lirep_admin_a9_complete(
 p_queue_id uuid,p_outcome text,p_provider_message_id text DEFAULT NULL,
 p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_q public.lirep_admin_notification_queue%rowtype;
BEGIN
 SELECT * INTO v_q FROM public.lirep_admin_notification_queue WHERE id=p_queue_id FOR UPDATE;
 IF v_q.id IS NULL THEN RAISE EXCEPTION 'QUEUE_ITEM_NOT_FOUND'; END IF;
 IF v_q.status='sent' THEN RETURN; END IF;
 IF v_q.status <> 'processing' THEN RAISE EXCEPTION 'QUEUE_NOT_PROCESSING'; END IF;
 IF p_outcome='sent' THEN
   IF nullif(btrim(coalesce(p_provider_message_id,'')),'') IS NULL
   THEN RAISE EXCEPTION 'PROVIDER_MESSAGE_ID_REQUIRED'; END IF;
   UPDATE public.lirep_admin_notification_queue
   SET status='sent',sent_at=now(),provider_message_id=left(p_provider_message_id,200),
       last_error=null,locked_at=null,updated_at=now() WHERE id=p_queue_id;
 ELSIF p_outcome='rejected' THEN
   UPDATE public.lirep_admin_notification_queue
   SET status=CASE WHEN attempt_count>=3 THEN 'held' ELSE 'failed' END,
       next_attempt_at=now()+interval '20 minutes',
       last_error=left(coalesce(p_error,'PROVIDER_REJECTED'),500),
       locked_at=null,updated_at=now() WHERE id=p_queue_id;
 ELSIF p_outcome='held' THEN
   -- An ambiguous provider result must never be automatically retried.
   UPDATE public.lirep_admin_notification_queue
   SET status='held',last_error=left(coalesce(p_error,'DELIVERY_UNCERTAIN'),500),
       locked_at=null,updated_at=now() WHERE id=p_queue_id;
 ELSE
   RAISE EXCEPTION 'INVALID_DELIVERY_OUTCOME';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.lirep_admin_a9_complete(uuid,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lirep_admin_a9_complete(uuid,text,text,text)
 TO service_role;
COMMIT;
SELECT CASE WHEN to_regprocedure('public.lirep_admin_a9_claim()') IS NOT NULL
AND to_regprocedure('public.lirep_admin_a9_complete(uuid,text,text,text)') IS NOT NULL
THEN 'PASS' ELSE 'FAIL' END AS a9_2_rpc,
(SELECT COUNT(*) FROM public.lirep_admin_notification_queue WHERE status='pending') AS pendientes,
(SELECT COUNT(*) FROM public.lirep_admin_notification_settings WHERE enabled) AS empresas_activadas;