-- LIREP | QA306 | ARCHIVO DE STAGING, NO APLICADO A PRODUCCION
-- Procedencia: definición de public.lirep_admin_a9_claim() en jitcayjaztceglqlmwvl.
-- PRECAUCIÓN: su ejecución modifica la función del despachador de notificaciones.
-- Requiere auditoría de seguridad y autorización explícita antes de cualquier despliegue.
-- No incluye secretos ni datos personales.
CREATE OR REPLACE FUNCTION public.lirep_admin_a9_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_q public.lirep_admin_notification_queue%rowtype;v_result jsonb;
begin
select q.* into v_q from public.lirep_admin_notification_queue q
join public.organizations o on o.id=q.organization_id and o.active=true
join public.lirep_admin_notification_settings s on s.organization_id=q.organization_id and s.enabled=true
join public.organization_email_settings e on e.organization_id=q.organization_id and e.is_active=true
where q.status in ('pending','failed') and q.next_attempt_at<=now() and q.attempt_count<3 and q.recipient=any(s.recipients) and nullif(btrim(e.from_email),'') is not null
order by q.created_at,q.id limit 1 for update of q skip locked;
if v_q.id is null then return null;end if;
update public.lirep_admin_notification_queue set status='processing',locked_at=now(),attempt_count=attempt_count+1,updated_at=now() where id=v_q.id;
select jsonb_build_object('queue_id',v_q.id,'recipient',v_q.recipient,'public_code',c.public_code,'public_prefix',o.public_prefix,'establishment',coalesce(to_jsonb(c)->>'establishment',''),'response_due_at',c.response_due_at,'from_name',e.from_name,'from_email') into v_result
from public.complaints c join public.organizations o on o.id=c.organization_id and o.active=true join public.organization_email_settings e on e.organization_id=c.organization_id and e.is_active=true
where c.id=v_q.complaint_id and c.organization_id=v_q.organization_id;
if v_result is null then update public.lirep_admin_notification_queue set status='held',last_error='CLAIM_DATA_MISSING',locked_at=null,updated_at=now() where id=v_q.id;return null;end if;
return v_result;
end;$function$;
-- Antes de habilitar un cron o Worker, revisar y fijar explícitamente
-- los privilegios EXECUTE para el rol de servicio previsto.
