-- LIREP QA: lectura del estado real de entrega de constancia.
-- No envía ni reintenta correos. No muestra direcciones de consumidores.
WITH target AS (
 SELECT c.id,c.organization_id,c.public_code,c.submitted_at,c.receipt_sent_at
 FROM public.complaints c
 JOIN public.organizations o ON o.id=c.organization_id
 WHERE o.public_prefix='LIREPQA1'
   AND c.public_code='LIREPQA1-LIBROQA001-2026-00000005'
)
SELECT
 t.public_code,
 t.submitted_at,
 CASE WHEN t.receipt_sent_at IS NULL THEN 'NO_REGISTRADO' ELSE 'REGISTRADO' END AS constancia_marcada_enviada,
 COALESCE(q.status,'SIN_COLA') AS estado_cola,
 q.attempt_count AS intentos,
 q.next_attempt_at AS siguiente_intento,
 q.sent_at AS fecha_envio_proveedor,
 q.provider AS proveedor,
 q.last_error AS ultimo_error,
 (SELECT count(*) FROM public.communication_evidence e
   WHERE e.organization_id=t.organization_id AND e.complaint_id=t.id) AS evidencias_envio,
 COALESCE(s.is_active,false) AS correo_empresa_habilitado,
 CASE WHEN array_length(s.internal_notification_emails,1)>0 THEN 'CONFIGURADAS' ELSE 'NO_CONFIGURADAS' END AS notificaciones_internas
FROM target t
LEFT JOIN public.complaint_delivery_queue q ON q.organization_id=t.organization_id AND q.complaint_id=t.id
LEFT JOIN public.organization_email_settings s ON s.organization_id=t.organization_id;
-- Si devuelve 0 filas: revisar el código exacto de la constancia. No asumir fallo SMTP.
