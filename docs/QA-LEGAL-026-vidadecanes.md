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
