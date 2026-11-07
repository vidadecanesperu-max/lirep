# LIREP WordPress 1.7.1 — Instalación y mantenimiento

**Paquete:** `lirep.zip`, con carpeta raíz `lirep/`. Se puede instalar en WordPress moderno sin Elementor Pro.

## Requisitos

- WordPress 6.5 o posterior (objetivo WordPress 7.1.4; pruebas automáticas de PHP y contrato, no pruebas visuales reales de Elementor).
- PHP 7.4 o posterior, preferentemente una versión soportada y parcheada por el proveedor de hosting.
- HTTPS, navegador moderno y acceso a Cloudflare Worker de LIREP.
- Empresa activa en LIREP, identificador público de 8 caracteres y dominio autorizado en el backend.

## Instalación

1. En WordPress: **Plugins > Añadir plugin > Subir plugin**, seleccionar `lirep.zip`, instalar y activar.
2. Abrir **Ajustes > LIREP**. Configurar el identificador de empresa. Nunca pegar claves privadas.
3. En Elementor Free o Pro: arrastrar el widget **Shortcode** y escribir `[lirep]`.
4. En Gutenberg: insertar el bloque **Shortcode** con `[lirep]`. También funciona en entradas y widgets que admitan shortcodes.
5. Guardar, publicar y revisar escritorio/móvil. Si el iframe es bloqueado por una política del sitio, usar el enlace externo visible bajo el formulario.
6. Validar el envío de una reclamación de prueba solo en un entorno QA autorizado, no con datos personales reales.

## Separación de ambientes

- `[lirep]`: Worker de producción fijo y prefijo configurado.
- `[lirep entorno="qa"]`: solo visible para administradores, y solo cuando se configura un Worker QA distinto.
- Los atributos del shortcode nunca permiten elegir otra empresa ni otro Worker arbitrario.
- La actualización conserva las opciones de las versiones 1.4.x y 1.5.0.

## Actualizaciones y seguridad

- El plugin declara `Update URI` propio; no utiliza el directorio WordPress.org.
- Busca releases oficiales en `vidadecanesperu-max/lirep`, con tags `lirep-wp-vX.Y.Z`.
- Solo acepta un asset `lirep.zip` (1 KB a 2 MB), servido por GitHub, con digest SHA-256 publicado por GitHub. Si falta o no coincide, la actualización se cancela.
- WordPress puede ofrecer una actualización normal en Plugins cuando exista una release compatible.
- Para actualizaciones automáticas **de seguridad**, activar el checkbox en **Ajustes > LIREP**; la release debe incluir exactamente `[LIREP-SECURITY]` en su descripción.
- El flujo de CI de GitHub genera el ZIP desde los archivos versionados y publica el asset al crear un tag; las releases solo deben publicarse después de revisión, QA y control de versión.
- La integridad SHA-256 valida la descarga contra el digest publicado en el mismo repositorio. **No sustituye una firma independiente del proveedor** ni protege frente al compromiso de la cuenta GitHub.
- Mantener WordPress, PHP, Elementor, el tema y demás plugins actualizados; disponer de copias de seguridad del sitio.

## Límites de la validación

El plugin se ha preparado con validación sintáctica y pruebas automatizadas aisladas. **La compatibilidad visual y el registro de reclamaciones en una instalación WordPress/Elementor real todavía requieren un E2E de staging**. El backend no se despliega ni se altera al instalar el ZIP.


## Nuevo asistente 1.7.1

El administrador abre Ajustes → LIREP, introduce RUC, razón social, dirección, correo y política de privacidad. Verifica primero el dominio, confirma el correo recibido y vuelve a pulsar «Verificar dominio y continuar». El prefijo se asigna automáticamente y se publica mediante `[lirep]`. Los clientes no necesitan solicitar un alta manual. **Este circuito requiere que la migración 1.7.1 y el Worker 1.7.1 estén desplegados y que LIREP_SELF_ONBOARDING=true tras QA**; sin ello el asistente falla cerrado.
