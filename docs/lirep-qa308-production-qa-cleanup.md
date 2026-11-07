# LIREP | QA308 | Limpieza de registros QA en producción

Fecha: 2026-11-07. **Ejecutado con autorización explícita del usuario.**

## Alcance

Producción: `hiidqmrgrioidvemixfe` (`lirep-prod`).
Empresas de prueba eliminadas: `LIREPQA1`, `LIREPQA2`.
Cuentas QA eliminadas: seis usuarios `lirep.qa237.*@example.com`.

**No se modificó ni eliminó la empresa `VIDACANE`, su reclamación ni la cuenta corporativa `notificaciones@360insol.com`.**

## Respaldo

Antes de cualquier eliminación, se creó y verificó en el proyecto staging `jitcayjaztceglqlmwvl`:

- Esquema privado `lirep_backup`, sin acceso `PUBLIC`, `anon` ni `authenticated`.
- Tabla `lirep_backup.qa308_prod_cleanup`, registro `qa308_20261107_before_prod_cleanup`.
- Snapshot de 45 filas QA en 23 tablas públicas, seis usuarios Auth (identificadores y metadatos no secretos) y un administrador global QA.
- Checksum MD5 del JSON normalizado: `2ff75fd603120dff95bb81ee62263e1a`; integridad comprobada antes y después de la limpieza.
- **No se almacenaron contraseñas, hashes de contraseñas ni tokens de sesión**. La restauración de cuentas Auth requeriría aprovisionarlas de nuevo y conciliar identificadores.

**Advertencia:** este respaldo está en staging, no es independiente de staging. No eliminar el proyecto staging hasta exportarlo a un destino duradero independiente y verificar su recuperación.

## Ensayo

La eliminación completa se ensayó en staging con una transacción `ROLLBACK`. Tras corregir una diferencia de esquema específica de staging (trigger `trg_lirep_guard_member_roles` y dos tablas adicionales), el ensayo pasó y la base staging conservó sus datos.

## Ejecución productiva

1. Se revocaron las cuatro membresías QA y el administrador global QA, comprobando que el administrador corporativo permanecía activo.
2. Se validaron los recuentos de cada tabla contra el snapshot antes de eliminar.
3. En una sola transacción con verificaciones de pre/postcondición se eliminaron **41 filas públicas QA restantes**, incluidos los registros de auditoría sintéticos y las tres reclamaciones de prueba, además de **seis usuarios Auth QA**. La eliminación de usuarios eliminó sus sesiones/identidades dependientes mediante claves foráneas.
4. Durante esa transacción, cinco triggers de inmutabilidad se deshabilitaron exclusivamente para la purga controlada de registros QA y se rehabilitaron **antes del COMMIT**. Las restricciones de claves foráneas permanecieron habilitadas.
5. Se verificó nuevamente el resultado mediante SQL de solo lectura.

## Resultado verificado después del COMMIT

| Control | Resultado |
|---|---:|
| Organizaciones totales | 1 |
| Organización `VIDACANE` activa | 1 |
| Organizaciones QA | 0 |
| Reclamaciones totales | 1 |
| Reclamación `VIDACANE` | 1 |
| Usuarios Auth totales | 1 |
| Usuarios Auth QA | 0 |
| Sesiones Auth restantes (cuenta corporativa) | 7 |
| Administradores globales corporativos activos | 1 |
| Administradores globales QA | 0 |
| Membresías administrativas QA | 0 |
| Triggers de integridad restaurados | 5/5 |
| Trigger de notificación de nueva reclamación | 1/1 habilitado |
| Integridad del respaldo QA en staging | PASS |

## Fuera del alcance

- **No se eliminó staging.**
- No se modificó la función productiva `lirep_admin_a9_claim()`, que conserva un filtro histórico a `LIREPQA1`. Es una incidencia independiente para el circuito de notificaciones multiempresa.
- No se desplegó nuevo código Cloudflare ni se ejecutó una reclamación real de prueba.
- La auditoría de RPC `SECURITY DEFINER` y las advertencias del Security Advisor siguen requiriendo revisión.
- No se declara seguridad absoluta ni cierre funcional end-to-end sin esas verificaciones.

## Referencia

Publicación administrativa QA305: `https://lirep-admin-360.pages.dev/`.
