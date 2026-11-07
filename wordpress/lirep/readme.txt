=== LIREP - Libro de Reclamaciones Virtual Peru ===
Contributors: vidadecanesperu-max
Tags: libro de reclamaciones, peru, reclamos, elementor, shortcode
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 1.6.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

LIREP incorpora un Libro de Reclamaciones externo en WordPress, Gutenberg y Elementor Free/Pro.

== Description ==
El plugin no almacena datos personales ni reclamaciones en WordPress. Se conecta al servicio LIREP mediante un iframe HTTPS. El identificador de empresa se administra en Ajustes > LIREP. Requiere una empresa activa en LIREP y una configuración de origen/dominio autorizada en el servicio.

== Installation ==
1. Subir el ZIP lirep.zip en Plugins > Añadir plugin > Subir plugin.
2. Activar y abrir Ajustes > LIREP.
3. Ingresar el identificador público de ocho caracteres asignado a la empresa.
4. Insertar [lirep] en una página, entrada, bloque Shortcode o widget Shortcode de Elementor.
5. Comprobar la apertura del formulario, Turnstile, registro y constancia con el servicio LIREP habilitado.

== Security ==
- No se almacenan secretos ni se expone una API de escritura en WordPress.
- El identificador no puede alterarse con atributos del shortcode.
- La URL de producción está fijada y el Worker QA es independiente.
- La vista QA solo está disponible para administradores.
- Los mensajes de redimensionado verifican el origen, la ventana y el identificador.
- Los scripts se cargan desde archivos locales, sin JavaScript inline.
- Las actualizaciones consultan GitHub Releases y exigen SHA-256 del asset publicado.
- En Ajustes > LIREP se pueden habilitar las actualizaciones automáticas de seguridad; las versiones oficiales deben estar marcadas [LIREP-SECURITY].
- Los controles de acceso, Turnstile, correo y retención de datos dependen del servicio LIREP, no de este plugin.

== Frequently Asked Questions ==
= ¿Necesito Elementor Pro? =
No. Utiliza el widget Shortcode en Elementor Free o Pro.

= ¿Puedo instalarlo en cualquier dominio? =
El ZIP se puede instalar en WordPress compatible, pero para recibir reclamaciones cada dominio y empresa deben estar habilitados en LIREP. Instalarlo no activa automáticamente un nuevo tenant.

= ¿Se actualiza automáticamente? =
La búsqueda de versiones utiliza GitHub Releases. Las actualizaciones normales se muestran en Plugins. Las automáticas de seguridad requieren activar la opción y publicar una versión oficial marcada [LIREP-SECURITY], con asset lirep.zip y digest SHA-256.

== Changelog ==
= 1.6.0 =
* Mantiene los ajustes 1.5.0 y la separación producción/QA.
* Assets externos compatibles con políticas CSP que bloquean JavaScript inline.
* Soporte de Elementor dinámico y Gutenberg por shortcode.
* Verificación de origen y tenant en la altura automática.
* Actualizaciones oficiales desde GitHub Releases con comprobación SHA-256 y opt-in de seguridad.
* Enlace accesible al formulario externo como alternativa al iframe.
