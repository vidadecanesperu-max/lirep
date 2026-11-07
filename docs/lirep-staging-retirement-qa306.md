# LIREP | QA306 | Inventario de retiro de staging

Estado: **documentación, no autorización para borrar**. Verificación de solo lectura del 7 de noviembre de 2026.

## Identidades

- Producción: `hiidqmrgrioidvemixfe` (`lirep-prod`).
- Staging: `jitcayjaztceglqlmwvl` (`lirep-staging`).
- Cloudflare Pages producción: `lirep-admin-360.pages.dev`, despliegue QA305 `dfea3009`.
- El paquete QA303 y el despliegue QA305 usan la URL de Supabase **producción**; no referencian staging.

## Inventario observado

| Recurso | Producción | Staging |
|---|---:|---:|
| Organizaciones | 3 | 2 |
| Reclamaciones | 4 | 5 |
| Usuarios Auth | 7 | 6 |
| Archivos Storage | 0 | 0 |
| Tablas administrativas LIREP | 8 | 8 |
| Funciones administrativas LIREP | 20 | 21 |
| Triggers LIREP habilitados | 3 | 3 |
| Edge Functions | 0 | 0 |

Staging contiene empresas sintéticas `LIREPQA1` y `LIREPQA2`; sus seis usuarios tienen correos `@example.com`. Se identificaron 21 migraciones en staging.

## Diferencia de código SQL relevante

Las 20 funciones administrativas comunes tienen definiciones y permisos de ejecución equivalentes **excepto** `public.lirep_admin_a9_claim()`.

- Producción conserva un filtro de empresa `o.public_prefix = 'LIREPQA1'`, apropiado solo para el circuito QA anterior, **no para un despachador de notificaciones multiempresa en producción**.
- Staging tiene la variante multiempresa sin ese filtro y una función auxiliar `lirep_admin_a9_claim_candidate()`.
- No se ha copiado esta variante a producción ni se han activado notificaciones administrativas. No activar el envío de correos sin una auditoría específica de permisos, aislamiento de empresas, colas y cron.

## Antes de borrar staging

1. Confirmar login real y autorización administrativa del panel publicado con un usuario de producción, sin compartir contraseñas.
2. Conservar migraciones y código SQL de staging necesarios para mantenimiento. El cambio multiempresa está archivado en `sql/qa306-lirep-admin-a9-claim-multitenant.sql`.
3. Verificar que ninguna configuración externa, navegador de QA, cron o integración siga apuntando a `jitcayjaztceglqlmwvl`.
4. Obtener autorización explícita de eliminación irreversible.

**No borrar `hiidqmrgrioidvemixfe`.** La eliminación de proyectos Supabase es permanente: https://supabase.com/docs/guides/platform/delete-project
