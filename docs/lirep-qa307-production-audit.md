# LIREP | QA307 | Auditoría de panel publicado y preparación de limpieza

Fecha: 2026-11-07. Estado: **solo lectura; sin cambios en producción ni staging**.

## Evidencia de navegador

El usuario verificó `https://lirep-admin-360.pages.dev/` con sesión autenticada:
- `LIREPQA2` (LIREP QA EMPRESA B): 0 reclamaciones, 2 usuarios vinculados.
- `LIREPQA1` (LIREP QA MULTIEMPRESA): 3 reclamaciones.
- `VIDACANE` (Vida de Canes EIRL): 1 reclamación, 0 usuarios vinculados.
- La interfaz muestra selector de empresas, bandeja, roles y botón de cierre de sesión.
- **Las capturas no constituyen una prueba negativa de RLS ni una prueba de cierre de sesión.**

## Confirmación SQL en Supabase producción `hiidqmrgrioidvemixfe`

- Tres organizaciones activas: `LIREPQA1`, `LIREPQA2`, `VIDACANE`.
- Cuatro reclamaciones `submitted`: 3 de `LIREPQA1`, 1 de `VIDACANE`.
- Cuatro membresías administrativas activas: 2 de `LIREPQA1`, 2 de `LIREPQA2`. `VIDACANE` tiene 0 membresías específicas.
- Siete usuarios Auth confirmados: seis `@example.com` y uno `@360insol.com`.
- **Dos propietarios globales activos: uno `@example.com` y uno `@360insol.com`.** El propietario QA es un acceso privilegiado real de producción y debe desactivarse antes de declarar una operación limpia, con autorización y plan de recuperación.
- Una notificación histórica `sent` de `LIREPQA1`; ninguna configuración de notificaciones habilitada.
- RLS habilitado en `organizations`, `complaints` y tablas administrativas examinadas. Las capturas no demuestran aislamiento por pruebas negativas.

## Supabase Security Advisors

- 14 avisos informativos `rls_enabled_no_policy` (tablas de servicio, revisar si el diseño es intencional).
- 1 aviso `anon_security_definer_function_executable` (`lirep_public_form_config`, posiblemente requerido para el formulario público; revisar exposición).
- 29 avisos `authenticated_security_definer_function_executable` (incluye RPC del panel; auditar comprobaciones internas de `auth.uid()` y pertenencia).
- 1 aviso `auth_leaked_password_protection` (protección de contraseñas filtradas deshabilitada).

Estos avisos no demuestran por sí mismos explotación; impiden declarar seguridad absoluta sin una revisión funcional de privilegios.

## Plan de retiro (NO EJECUTADO)

1. Conservar respaldo verificable de esquema, migraciones y datos QA necesarios para reconstruir staging.
2. Comprobar sesión real de producción y aislamiento negativo entre empresas mediante cuentas de roles distintos.
3. Con autorización explícita, revocar primero acceso privilegiado QA en producción, y luego limpiar seis usuarios QA, dos empresas QA, tres reclamaciones QA y sus dependencias. **No borrar `VIDACANE` ni su reclamación**.
4. Verificar de nuevo el panel, el formulario público, el Worker y la cuenta administradora real.
5. Con autorización independiente, eliminar el proyecto staging `jitcayjaztceglqlmwvl` después del respaldo y de verificar que no hay dependencias activas.

El despliegue QA305 fue confirmado por PowerShell: vista previa y producción HTTP 200, Worker y backend operativos.
