<?php
/**
 * Plugin Name: LIREP - Libro de Reclamaciones Virtual Peru
 * Plugin URI: https://github.com/vidadecanesperu-max/lirep
 * Description: Libro de Reclamaciones LIREP multiempresa, compatible con WordPress, Gutenberg y Elementor. Los datos permanecen en LIREP.
 * Version: 1.7.1
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Author: 360 Integral Solutions
 * Author URI: https://vidadecanes.pe
 * License: GPL-2.0-or-later
 * Text Domain: lirep
 * Update URI: https://github.com/vidadecanesperu-max/lirep
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!defined('LIREP_VERSION')) {
    define('LIREP_VERSION', '1.7.1');
}
if (!defined('LIREP_PROD_BASE')) {
    define('LIREP_PROD_BASE', 'https://lirep-public-api.vidadecanes-peru.workers.dev');
}
if (!defined('LIREP_RELEASE_API')) {
    define('LIREP_RELEASE_API', 'https://api.github.com/repos/vidadecanesperu-max/lirep/releases?per_page=30');
}

/** The tenant is always selected in administrator-controlled options, never in a shortcode. */
function lirep_valid_prefix($value) {
    if (!is_scalar($value)) {
        return '';
    }
    $prefix = strtoupper(trim((string) $value));
    return preg_match('/^[A-Z0-9]{8}$/D', $prefix) ? $prefix : '';
}

function lirep_sanitize_prefix($value) {
    $prefix = lirep_valid_prefix($value);
    if ('' === $prefix && '' !== trim((string) (is_scalar($value) ? $value : ''))) {
        add_settings_error('lirep_public_prefix', 'lirep_invalid_prefix', 'El identificador debe tener ocho caracteres alfanumericos.', 'error');
        return (string) get_option('lirep_public_prefix', '');
    }
    return $prefix;
}

function lirep_normalize_worker_base($value) {
    if (!is_scalar($value)) {
        return '';
    }
    $value = rtrim(trim((string) $value), '/');
    if ('' === $value) {
        return '';
    }
    $parts = wp_parse_url($value);
    if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || 'https' !== strtolower($parts['scheme'])) {
        return '';
    }
    foreach (array('user', 'pass', 'port', 'query', 'fragment', 'path') as $key) {
        if (isset($parts[$key]) && '' !== $parts[$key]) {
            return '';
        }
    }
    $host = strtolower($parts['host']);
    if (!preg_match('/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/D', $host)) {
        return '';
    }
    return 'https://' . $host;
}

function lirep_sanitize_qa_worker($value) {
    $base = lirep_normalize_worker_base($value);
    if ('' === $base && is_scalar($value) && '' !== trim((string) $value)) {
        add_settings_error('lirep_qa_worker_url', 'lirep_invalid_qa_url', 'QA requiere un Worker HTTPS de Cloudflare sin rutas, puertos ni parametros.', 'error');
        return (string) get_option('lirep_qa_worker_url', '');
    }
    if (LIREP_PROD_BASE === $base) {
        add_settings_error('lirep_qa_worker_url', 'lirep_qa_matches_prod', 'El Worker QA debe ser distinto del de produccion.', 'error');
        return (string) get_option('lirep_qa_worker_url', '');
    }
    return $base;
}

function lirep_sanitize_qa_prefix($value) {
    $prefix = lirep_valid_prefix($value);
    if ('' === $prefix || $prefix === lirep_valid_prefix(get_option('lirep_public_prefix', ''))) {
        add_settings_error('lirep_qa_public_prefix', 'lirep_invalid_qa_prefix', 'QA debe tener un identificador valido y diferente del de produccion.', 'error');
        return (string) get_option('lirep_qa_public_prefix', 'LIREPQA1');
    }
    return $prefix;
}

function lirep_sanitize_auto_security($value) {
    return ('1' === (string) $value) ? '1' : '0';
}

function lirep_register_settings() {
    register_setting('lirep_settings', 'lirep_public_prefix', array(
        'type' => 'string', 'sanitize_callback' => 'lirep_sanitize_prefix', 'default' => '',
    ));
    register_setting('lirep_settings', 'lirep_qa_public_prefix', array(
        'type' => 'string', 'sanitize_callback' => 'lirep_sanitize_qa_prefix', 'default' => 'LIREPQA1',
    ));
    register_setting('lirep_settings', 'lirep_qa_worker_url', array(
        'type' => 'string', 'sanitize_callback' => 'lirep_sanitize_qa_worker', 'default' => '',
    ));
    register_setting('lirep_settings', 'lirep_auto_security_updates', array(
        'type' => 'string', 'sanitize_callback' => 'lirep_sanitize_auto_security', 'default' => '0',
    ));
}
add_action('admin_init', 'lirep_register_settings');

function lirep_admin_menu() {
    add_options_page('LIREP', 'LIREP', 'manage_options', 'lirep', 'lirep_settings_page');
}
add_action('admin_menu', 'lirep_admin_menu');

function lirep_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    ?>
    <div class="wrap">
      <h1>LIREP — Libro de Reclamaciones</h1>
      <?php settings_errors(); ?>
      <p>Conecta este sitio a la empresa habilitada en LIREP. No introduzcas claves de Supabase, API keys ni contraseñas.</p>
      <form method="post" action="options.php">
        <?php settings_fields('lirep_settings'); ?>
        <table class="form-table" role="presentation">
          <tr>
            <th scope="row"><label for="lirep_public_prefix">Identificador público de empresa</label></th>
            <td><input id="lirep_public_prefix" name="lirep_public_prefix" class="regular-text" type="text" maxlength="8" pattern="[A-Za-z0-9]{8}" autocomplete="off" value="<?php echo esc_attr(get_option('lirep_public_prefix', '')); ?>" />
              <p class="description">Ocho caracteres asignados por LIREP. Ejemplo: VIDACANE. Es obligatorio para publicar el formulario.</p></td>
          </tr>
          <tr><th scope="row">Servicio de producción</th><td><code><?php echo esc_html(LIREP_PROD_BASE); ?></code><p class="description">Dirección fija; no editable por contenido o visitantes.</p></td></tr>
          <tr><th scope="row"><label for="lirep_qa_public_prefix">Identificador de pruebas</label></th>
            <td><input id="lirep_qa_public_prefix" name="lirep_qa_public_prefix" class="regular-text" type="text" maxlength="8" pattern="[A-Za-z0-9]{8}" value="<?php echo esc_attr(get_option('lirep_qa_public_prefix', 'LIREPQA1')); ?>" />
              <p class="description">Solo para vista previa de administradores; nunca se sustituye por el identificador de producción.</p></td></tr>
          <tr><th scope="row"><label for="lirep_qa_worker_url">Worker de pruebas</label></th>
            <td><input id="lirep_qa_worker_url" name="lirep_qa_worker_url" class="regular-text" type="url" placeholder="https://nombre.cuenta.workers.dev" value="<?php echo esc_attr(get_option('lirep_qa_worker_url', '')); ?>" />
              <p class="description">Opcional. Debe ser un Worker distinto de producción.</p></td></tr>
          <tr><th scope="row">Actualizaciones automáticas de seguridad</th>
            <td><input type="hidden" name="lirep_auto_security_updates" value="0" />
              <label><input type="checkbox" name="lirep_auto_security_updates" value="1" <?php checked(get_option('lirep_auto_security_updates', '0'), '1'); ?> />
              Instalar automáticamente versiones marcadas como actualización de seguridad por LIREP.</label>
              <p class="description">Las versiones oficiales se consultan en GitHub y se verifica SHA-256 del paquete antes de instalarlo. Las actualizaciones normales siguen disponibles en Plugins. Se requiere una publicación oficial con ZIP y digest.</p></td></tr>
        </table>
        <?php submit_button('Guardar configuración'); ?>
      </form>
      <h2>Insertar en WordPress y Elementor</h2>
      <p>En cualquier página, entrada o widget Shortcode de Elementor Free/Pro utiliza <code>[lirep]</code>. Para una vista de QA exclusiva del administrador: <code>[lirep entorno="qa"]</code>.</p>
      <p>El sitio debe estar autorizado para la empresa en LIREP. El plugin no registra ni procesa reclamaciones dentro de WordPress.</p>
      <p>Versión instalada: <strong><?php echo esc_html(LIREP_VERSION); ?></strong>. Actualizaciones: <a href="<?php echo esc_url(admin_url('plugins.php')); ?>">Plugins</a>.</p>
    </div>
    <?php
}

function lirep_plugin_action_links($links) {
    array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=lirep')) . '">Configurar LIREP</a>');
    return $links;
}
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'lirep_plugin_action_links');

function lirep_enqueue_assets() {
    wp_enqueue_style('lirep-embed', plugins_url('assets/css/lirep-embed.css', __FILE__), array(), LIREP_VERSION);
    wp_enqueue_script('lirep-embed', plugins_url('assets/js/lirep-embed.js', __FILE__), array(), LIREP_VERSION, true);
}

// Elementor can render shortcodes asynchronously in its editor; preload tiny local assets.
add_action('wp_enqueue_scripts', 'lirep_enqueue_assets');
add_action('elementor/preview/enqueue_scripts', 'lirep_enqueue_assets');
add_action('elementor/editor/after_enqueue_scripts', 'lirep_enqueue_assets');

function lirep_shortcode($atts = array()) {
    $atts = shortcode_atts(array('entorno' => 'produccion'), $atts, 'lirep');
    $environment = strtolower(trim((string) $atts['entorno']));
    if (!in_array($environment, array('produccion', 'qa'), true)) {
        return '<p role="status">LIREP: entorno no válido.</p>';
    }
    if ('qa' === $environment && !current_user_can('manage_options')) {
        return '<p role="status">La vista de pruebas LIREP está restringida.</p>';
    }

    $prefix = lirep_valid_prefix(get_option('lirep_public_prefix', ''));
    $base = LIREP_PROD_BASE;
    if ('qa' === $environment) {
        $prefix = lirep_valid_prefix(get_option('lirep_qa_public_prefix', 'LIREPQA1'));
        $base = lirep_normalize_worker_base(get_option('lirep_qa_worker_url', ''));
        if ('' === $base || LIREP_PROD_BASE === $base || $prefix === lirep_valid_prefix(get_option('lirep_public_prefix', ''))) {
            return '<p role="status">LIREP QA: configura un Worker y un identificador independientes en Ajustes → LIREP.</p>';
        }
    }
    if ('' === $prefix) {
        return current_user_can('manage_options')
            ? '<p role="status">LIREP: configura el identificador público en Ajustes → LIREP.</p>'
            : '<p role="status">El Libro de Reclamaciones no está disponible temporalmente.</p>';
    }

    lirep_enqueue_assets();
    $src = add_query_arg(array('public_prefix' => $prefix, 'embed' => '1'), $base . '/libro-de-reclamaciones');
    $frame_id = 'lirep-frame-' . wp_unique_id();
    $html = '<div class="lirep-container" data-lirep-embed="1" data-lirep-origin="' . esc_attr($base) . '" data-lirep-prefix="' . esc_attr($prefix) . '" data-lirep-environment="' . esc_attr($environment) . '">';
    $html .= '<iframe id="' . esc_attr($frame_id) . '" class="lirep-frame" src="' . esc_url($src) . '" title="Libro de Reclamaciones Virtual" loading="eager" scrolling="no" referrerpolicy="no-referrer"></iframe>';
    $html .= '<p class="lirep-direct-link"><a href="' . esc_url($src) . '" target="_blank" rel="noopener noreferrer">Abrir el Libro de Reclamaciones en una ventana nueva</a></p>';
    $html .= '</div>';
    return $html;
}
add_shortcode('lirep', 'lirep_shortcode');

/** Only releases explicitly published for this WordPress plugin can supply updates. */
function lirep_valid_release($release) {
    if (!is_array($release) || !empty($release['draft']) || !empty($release['prerelease']) || !isset($release['tag_name']) || !is_string($release['tag_name'])) {
        return null;
    }
    $tag = $release['tag_name'];
    if (!preg_match('/^lirep-wp-v([0-9]+\.[0-9]+\.[0-9]+)$/D', $tag, $match)) {
        return null;
    }
    if (!isset($release['assets']) || !is_array($release['assets'])) {
        return null;
    }
    foreach ($release['assets'] as $asset) {
        if (!is_array($asset) || !isset($asset['name'], $asset['browser_download_url'], $asset['digest'])) {
            continue;
        }
        if ('lirep.zip' !== $asset['name'] || !is_string($asset['digest']) || !preg_match('/^sha256:([a-f0-9]{64})$/Di', $asset['digest'], $hash)) {
            continue;
        }
        $url = 'https://github.com/vidadecanesperu-max/lirep/releases/download/' . $tag . '/lirep.zip';
        if (!is_string($asset['browser_download_url']) || $asset['browser_download_url'] !== $url || !isset($asset['size']) || (int) $asset['size'] < 1000 || (int) $asset['size'] > 2097152) {
            continue;
        }
        return array(
            'version' => $match[1],
            'tag' => $tag,
            'url' => $url,
            'sha256' => strtolower($hash[1]),
            'security' => isset($release['body']) && is_string($release['body']) && false !== strpos($release['body'], '[LIREP-SECURITY]'),
        );
    }
    return null;
}

function lirep_release_info($force = false) {
    $key = 'lirep_release_v171';
    if (!$force) {
        $cached = get_transient($key);
        if (is_array($cached)) {
            return !empty($cached['none']) ? null : $cached;
        }
    }
    $response = wp_safe_remote_get(LIREP_RELEASE_API, array(
        'timeout' => 10,
        'redirection' => 2,
        'limit_response_size' => 524288,
        'headers' => array('Accept' => 'application/vnd.github+json', 'User-Agent' => 'LIREP-WordPress/' . LIREP_VERSION),
    ));
    if (is_wp_error($response) || 200 !== (int) wp_remote_retrieve_response_code($response)) {
        set_transient($key, array('none' => true), 15 * MINUTE_IN_SECONDS);
        return null;
    }
    $releases = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($releases)) {
        set_transient($key, array('none' => true), 15 * MINUTE_IN_SECONDS);
        return null;
    }
    $latest = null;
    foreach ($releases as $release) {
        $candidate = lirep_valid_release($release);
        if (null !== $candidate && (null === $latest || version_compare($candidate['version'], $latest['version'], '>'))) {
            $latest = $candidate;
        }
    }
    set_transient($key, null === $latest ? array('none' => true) : $latest, null === $latest ? 15 * MINUTE_IN_SECONDS : 6 * HOUR_IN_SECONDS);
    return $latest;
}

/** WordPress 5.8+ Update URI host filter; does not intercept any other GitHub plugin. */
function lirep_update_plugins_github($update, $plugin_data, $plugin_file, $locales) {
    unset($plugin_data, $locales);
    if ($plugin_file !== plugin_basename(__FILE__)) {
        return $update;
    }
    $release = lirep_release_info();
    if (null === $release || !version_compare($release['version'], LIREP_VERSION, '>')) {
        return $update;
    }
    return array(
        'id' => 'https://github.com/vidadecanesperu-max/lirep',
        'slug' => 'lirep',
        'version' => $release['version'],
        'url' => 'https://github.com/vidadecanesperu-max/lirep/releases/tag/' . $release['tag'],
        'package' => $release['url'],
        'requires' => '6.5',
        'requires_php' => '7.4',
        'lirep_security' => $release['security'],
    );
}
add_filter('update_plugins_github.com', 'lirep_update_plugins_github', 10, 4);

/** Verify the GitHub asset digest before handing any update archive to WordPress. */
function lirep_upgrader_pre_download($reply, $package, $upgrader, $hook_extra) {
    unset($upgrader, $hook_extra);
    if (false !== $reply || !is_string($package)) {
        return $reply;
    }
    if (!preg_match('~^https://github\.com/vidadecanesperu-max/lirep/releases/download/lirep-wp-v[0-9]+\.[0-9]+\.[0-9]+/lirep\.zip$~D', $package)) {
        return $reply;
    }
    $release = lirep_release_info();
    if (null === $release || $release['url'] !== $package || !version_compare($release['version'], LIREP_VERSION, '>')) {
        return new WP_Error('lirep_update_not_verified', 'LIREP: actualización bloqueada porque el paquete no coincide con una versión oficial verificada.');
    }
    if (!function_exists('download_url')) {
        return new WP_Error('lirep_update_unavailable', 'LIREP: el descargador seguro de WordPress no está disponible.');
    }
    $file = download_url($package, 30);
    if (is_wp_error($file)) {
        return $file;
    }
    $actual = hash_file('sha256', $file);
    if (!is_string($actual) || !hash_equals($release['sha256'], strtolower($actual))) {
        @unlink($file);
        return new WP_Error('lirep_update_hash_mismatch', 'LIREP: el archivo descargado no coincide con el SHA-256 publicado. Actualización cancelada.');
    }
    return $file;
}
add_filter('upgrader_pre_download', 'lirep_upgrader_pre_download', 10, 4);

/** Security auto-updates are opt-in and require an explicitly marked release. */
function lirep_auto_update_plugin($update, $item) {
    if (!is_object($item) || !isset($item->plugin) || $item->plugin !== plugin_basename(__FILE__)) {
        return $update;
    }
    if ('1' === (string) get_option('lirep_auto_security_updates', '0') && !empty($item->lirep_security)) {
        return true;
    }
    return $update;
}
add_filter('auto_update_plugin', 'lirep_auto_update_plugin', 10, 2);

// The onboarding assistant replaces the legacy manual-prefix settings page.
require_once __DIR__ . '/includes/onboarding.php';
