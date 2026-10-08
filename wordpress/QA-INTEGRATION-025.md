# LIREP · QA-INTEGRATION-025 · WordPress + Elementor Free

**Estado:** pendiente de prueba en una instalación WordPress real. No habilitar correos productivos.

## Instalación controlada

1. Descargar la carpeta `wordpress/lirep` como ZIP de plugin, preservando `lirep.php` en la raíz de esa carpeta.
2. En WordPress: Plugins → Añadir plugin → Subir plugin → Activar.
3. Ajustes → LIREP → configurar el identificador público de **8 caracteres** asignado a la empresa.
4. Crear una página y agregar un widget **Shortcode** de Elementor Free con `[lirep]`.
5. Publicar en un dominio autorizado para esa organización. El shortcode no permite cambiar de empresa desde atributos.

## Criterios de aceptación

- [ ] La página carga en escritorio y móvil sin scroll horizontal.
- [ ] Se muestra el proveedor correcto y el libro correspondiente a la empresa configurada.
- [ ] El dominio no autorizado no puede registrar reclamos mediante el gateway.
- [ ] El formulario rechaza datos obligatorios incompletos.
- [ ] Cloudflare Turnstile valida el envío.
- [ ] Un reclamo QA obtiene correlativo único y constancia segura.
- [ ] El correo QA llega una sola vez y se registra evidencia en Supabase.
- [ ] El enlace de constancia sin token no revela datos personales.
- [ ] La página funciona con Elementor Free, sin Elementor Pro.
- [ ] La configuración del plugin solo es editable por administradores de WordPress.
- [ ] Los correos de producción permanecen bloqueados.

## Precauciones

- Nunca utilizar datos reales de consumidores durante QA.
- No cambiar `VIDACANE` por `LIREPQA1` en un sitio productivo.
- El bloqueo de envíos productivos se aplica en el Worker y en el descubrimiento del cron; no depende únicamente del estado de configuración de correo de la empresa.
- El botón «Imprimir / Guardar como PDF» utiliza la impresión del navegador: **no** equivale a un PDF generado y almacenado por el servidor.
- Esta lista no acredita por sí sola conformidad legal; exige revisión normativa, privacidad, retención y respaldo antes del lanzamiento.
