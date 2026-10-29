# LIREP ADMIN A1 — Primera entrega aislada

**Estado:** candidato funcional, no desplegado. No sustituye el libro público ni modifica su Worker, su WordPress o sus envíos.

## Contenido
- `admin/index.html`: interfaz responsive de inicio de sesión y bandeja por empresa.
- `admin/config.example.js`: ejemplo de configuración; copiar como `config.js` en el hosting.
- `supabase/migrations/20261028223000_lirep_admin_a1_readonly_tenants.sql`: tablas de membresías y dos RPC de consulta.

## Instalación controlada
1. Respaldar el esquema de la base **LIREP**; aplicar la migración SQL solamente en el proyecto correcto `hiidqmrgrioidvemixfe` tras la revisión. No aplicarla en otro Supabase.
2. Crear o verificar un usuario Supabase Auth y registrar su `auth.users.id`, sin compartir contraseñas. Asignar membresía con SQL ejecutado por administrador:
   ```sql
   insert into public.lirep_admin_memberships(user_id,organization_id,role)
   select '<UUID_USUARIO_AUTH>'::uuid,id,'company_admin'
   from public.organizations where public_prefix='VIDACANE'
   on conflict (user_id,organization_id)
   do update set role=excluded.role,active=true;
   ```
3. Copiar `admin/config.example.js` como `admin/config.js` en el **hosting privado o protegido** y completar la clave pública de Supabase (anon/publishable, nunca service_role).
4. Configurar las URLs de redirección permitidas y controles antiabuso de Supabase Auth. Publicar `admin/` en un hosting estático separado del formulario público; la interfaz NO confiere permisos por sí sola, las RPC verifican `auth.uid()`.
5. Probar login válido, login sin membresía, aislamiento de dos empresas, cierre de sesión y llamadas directas no autenticadas. Hasta ese QA, **no anunciar enlace de administración en producción**.

## Seguridad y limitaciones
- Consultas de solo lectura, máximo 100 reclamaciones; no expone nombres, documentos, teléfonos, direcciones, correos ni texto del reclamo en el primer bloque.
- Las membresías no pueden ser otorgadas por `anon` ni por `authenticated`; solo por un operador confiable con acceso administrativo a la base.
- Tokens solo en memoria: al recargar la página hay que volver a ingresar; no persistimos credenciales en localStorage.
- Los privilegios se comprueban en PostgreSQL en cada RPC. Sin membresía, la RPC rechaza el acceso.
- Pendientes de próximas fases: altas de empresa, flujo de estados, respuestas, auditoría, reportes y administración de usuarios desde el panel.
