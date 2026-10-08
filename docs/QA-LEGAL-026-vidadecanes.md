# LIREP · QA-LEGAL-026 · Vida de Canes

Fecha: 2026-10-08. Estado: revisión documental; **no habilita producción**.

## Identidad y alcance
- Dominio de integración: https://vidadecanes.pe
- Organización LIREP: VIDACANE; libro LR001.
- La página anterior publicada identifica a **VIDA DE CANES E.I.R.L.**, RUC **20609667584**. Contrastar esos datos con la configuración de organización de LIREP antes del reemplazo.
- El nombre mostrado en QA fue **Vida de Canes ECO**. Verificar si es el nombre comercial correcto y mantener la razón social visible en la hoja/constancia.

## Incidencia normativa bloqueante
La página anterior https://vidadecanes.pe/libro-de-reclamaciones-virtual/ todavía muestra 30 días calendario y posible ampliación. Ese texto está desactualizado.

Indecopi indica que reclamos y quejas deben responderse en **15 días hábiles improrrogables** (DS 101-2022-PCM, Ley 31435). Fuentes:
- https://www.gob.pe/institucion/indecopi/noticias/641594-modifican-reglamento-del-libro-de-reclamaciones-para-que-proveedores-atiendan-reclamos-y-quejas-de-clientes-en-15-dias-habiles
- https://consumidor.gob.pe/libro-de-reclamaciones/
- https://www.gob.pe/institucion/indecopi/normas-legales/3346742-101-2022-pcm

En julio de 2026 se publicó un **proyecto** de modificación normativa, no confundir con una modificación vigente sin verificar su aprobación:
- https://www.gob.pe/institucion/pcm/normas-legales/8406634-244-2026-pcm

## Bloqueantes previos al reemplazo público
1. Verificar nombre legal, RUC, dirección, establecimiento, correo de atención y nombre comercial contra los datos reales en Supabase.
2. Confirmar texto legal vigente en el formulario, constancia y política de privacidad; no mantener la cláusula de 30 días calendario.
3. Validar que el flujo de constancia y comunicación productiva esté operativo **antes** de publicar el reemplazo. Actualmente el correo productivo está bloqueado por diseño.
4. Validar registro, acceso administrativo, exportación, respaldo, recuperación y trazabilidad de reclamaciones.
5. Revisar base legal, finalidades, derechos ARCO, transferencias internacionales y retención de datos personales.
6. Verificar cómputo de 15 días hábiles y calendario de feriados de Perú para los años siguientes.
7. Preservar registros del libro anterior, sin mezclar sus correlativos con los de LIREP.
8. Ensayar reversión: conservar página anterior hasta aprobar reemplazo.

## QA visual completado
- Formulario con prefijo VIDACANE en borrador 2559.
- Escritorio y móvil 390px sin scroll interno, sin scroll horizontal ni altura infinita.
- Todos los campos y botón de registro accesibles en inspección de solo lectura.
- No se enviaron reclamos productivos ni se publicó el borrador.

**Decisión:** continuar con preparación técnica, pero mantener producción deshabilitada hasta resolver los bloqueantes.

## QA-LEGAL-027 · Política de privacidad (2026-10-08)
- **PUBLICADO / VERIFICADO:** https://vidadecanes.pe/politica-de-privacidad/ carga con contenido real, sin error 404, según inspección de navegador automatizada posterior a la publicación.
- **PUBLICADO / VERIFICADO:** el formulario Worker con `public_prefix=VIDACANE&embed=1` muestra el aviso de plazo de respuesta de 15 días hábiles improrrogables y un enlace hacia esa política. Commit del aviso: `69e8a6e947640af3be1f2c649334fc2a166e28ca`.
- **Contenido de política publicado:** identificación de VIDA DE CANES E.I.R.L. / RUC 20609667584, finalidades, bases legales, derechos de titulares, proveedores tecnológicos, seguridad y conservación. **Publicación no equivale a dictamen de cumplimiento legal.**
- **Pendiente de verificación documental:** exactitud de razón social y RUC, domicilio del responsable, canal de ejercicio de derechos ARCO, inventario y registro de bancos de datos personales cuando corresponda, plazos específicos de retención, transferencias internacionales y contratos con encargados.
- **QA interpretado correctamente:** la política de privacidad no necesita repetir el plazo de atención de reclamos, pues dicho plazo está en el formulario. Un enlace de navegación hacia el Libro de Reclamaciones no constituye por sí mismo un envío de reclamo. No se ha ejecutado un envío productivo.
- **NO GO:** página pública anterior intacta; correo productivo bloqueado; no sustituir página hasta aprobar verificación de identidad, constancia, correo, retención, backup y rollback.

## QA-RELEASE-028 · Auditoría de acceso y circuito de constancias (2026-10-08)
- **Conexión Supabase de ChatGPT:** `list_projects` solo expone `nhywemyknewnnlpkocof` (otro proyecto). La instancia LIREP `hiidqmrgrioidvemixfe` **no es accesible** con esta conexión. No se ejecutó SQL ni se verificaron datos de producción en esa base.
- **Inspección estática Worker:** `worker/src/index.js` utiliza `lirep_secure_receipt_data` con `p_public_prefix`, `p_public_code`, `p_access_token` para recuperar constancias. La comprobación de autorización efectiva requiere revisar función SQL, RLS y prueba negativa de token.
- **Control de correo:** `sendSecureReceipt(prefix, code, env)` retorna inmediatamente cuando `prefix !== "LIREPQA1"`; `VIDACANE` permanece bloqueado. No se modificó el control.
- **Pendiente de QA funcional:** entrega y formato de constancia, expiración/revocación de token, validación de correo destinatario, cola de correo y reintentos, exportación, backup y restauración; verificar calendario de días hábiles en la función que calcula `response_due_at`.
- **Criterio de aprobación:** obtener acceso explícito al proyecto Supabase LIREP y ejecutar comprobaciones no destructivas antes de autorizar correos productivos o sustituir la página pública. No registrar tokens de acceso ni datos personales en evidencias de QA.
