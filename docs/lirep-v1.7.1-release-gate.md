# LIREP v1.7.1 — Puerta de publicación

## Confirmado en QA

- El plugin 1.7.1 incorpora comprobación de disponibilidad del servicio; no solicita datos de empresa si la API está deshabilitada.
- Registro nuevo y vinculación de una empresa existente requieren prueba de control del dominio y correo confirmado.
- Para una empresa existente, la identidad debe ser un miembro activo con rol company_admin de esa empresa.
- RUC y dominio reservados 15 minutos antes de probar el dominio; 24 horas tras verificación.
- Migraciones 001–007 aplicadas únicamente a staging jitcayjaztceglqlmwvl.
- La función lirep_admin_a9_claim() de staging no contiene el filtro QA LIREPQA1, y conserva el aislamiento por organization_id.

## Bloqueos antes de publicar

1. Desplegar Worker QA aislado contra staging, con rate limiting y secretos QA; nunca apuntarlo a producción.
2. Disponer de URL de administración QA conectada a Supabase staging y autorizada como redirect URL de Auth.
3. Probar entrega real de correo de verificación, enlace de invitación y primer acceso en QA, con datos sintéticos.
4. Probar WordPress/Elementor en dominio QA autorizado, incluyendo /wp-json/lirep/v1/challenge y el iframe.
5. Antes de activar altas productivas, aplicar y verificar la migración 008 de claim multiempresa en producción, tras respaldo y preflight; comprobar cola existente y destinatarios para evitar envíos inesperados.
6. Fusionar PR tras revisión y crear primera GitHub Release con asset lirep.zip y SHA256, para habilitar el actualizador.
7. Habilitar LIREP_SELF_ONBOARDING=true en producción solo después del E2E y monitoreo inicial.

**Sin estos puntos, no declarar cierre productivo ni activar el autorregistro en el Worker de producción.**
