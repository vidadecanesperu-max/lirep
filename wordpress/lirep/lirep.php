<?php
/**
 * Plugin Name: LIREP - Libro de Reclamaciones Virtual Peru
 * Description: Integracion universal del Libro de Reclamaciones LIREP.
 * Version: 1.4.1
 * Author: 360 Integral Solutions
 */

if (!defined('ABSPATH')) exit;

define('LIREP_EMBED_BASE', 'https://lirep-public-api.vidadecanes-peru.workers.dev');

function lirep_register_settings() {
    register_setting('lirep_settings', 'lirep_public_prefix', [
        'type' => 'string',
        'sanitize_callback' => function($value) {
            $prefix = strtoupper(trim((string) $value));
            if (!preg_match('/^[A-Z0-9]{8}$/', $prefix)) {
                add_settings_error(
                    'lirep_public_prefix',
                    'lirep_invalid_prefix',
                    'El identificador debe contener exactamente 8 caracteres alfanuméricos.',
                    'error'
                );
                return (string) get_option('lirep_public_prefix', '');
            }
            return $prefix;
        },
        'default' => ''
    ]);
}
add_action('admin_init', 'lirep_register_settings');

function lirep_admin_menu() {
    add_options_page('LIREP', 'LIREP', 'manage_options', 'lirep', 'lirep_settings_page');
}
add_action('admin_menu', 'lirep_admin_menu');

function lirep_settings_page() {
    if (!current_user_can('manage_options')) return;
    ?>
    <div class="wrap">
      <h1>LIREP</h1>
      <?php settings_errors('lirep_public_prefix'); ?>
      <p>Configura una sola vez el identificador público asignado a esta empresa.</p>
      <form method="post" action="options.php">
        <?php settings_fields('lirep_settings'); ?>
        <table class="form-table">
          <tr>
            <th scope="row"><label for="lirep_public_prefix">Identificador público</label></th>
            <td>
              <input id="lirep_public_prefix" name="lirep_public_prefix" type="text"
                     maxlength="8" pattern="[A-Za-z0-9]{8}"
                     value="<?php echo esc_attr(get_option('lirep_public_prefix', '')); ?>"
                     class="regular-text" />
              <p class="description">Ejemplo: VIDACANE. Lo entrega 360 Integral Solutions al activar la empresa.</p>
            </td>
          </tr>
        </table>
        <?php submit_button('Guardar'); ?>
      </form>
      <p><strong>Elementor Free:</strong> agrega un widget Shortcode y escribe <code>[lirep]</code>.</p>
    </div>
    <?php
}

function lirep_shortcode($atts = []) {
    // The tenant identifier is administrator-controlled; shortcode attributes cannot override it.
    $prefix = strtoupper(trim((string) get_option('lirep_public_prefix', '')));
    if (!preg_match('/^[A-Z0-9]{8}$/', $prefix)) {
        return '<div style="padding:16px;border:1px solid #ddd;border-radius:10px">LIREP no está configurado. Ingresa el identificador público en Ajustes → LIREP.</div>';
    }

    $src = add_query_arg(['public_prefix' => $prefix, 'embed' => '1'], LIREP_EMBED_BASE . '/libro-de-reclamaciones');
    $iframe_id = 'lirep-frame-' . wp_unique_id();
    $origin = wp_parse_url(LIREP_EMBED_BASE, PHP_URL_SCHEME) . '://' . wp_parse_url(LIREP_EMBED_BASE, PHP_URL_HOST);
    $html = '<div class="lirep-container"><iframe id="' . esc_attr($iframe_id) . '" src="' . esc_url($src) . '" title="Libro de Reclamaciones" loading="lazy" scrolling="no" style="width:100%;height:1600px;border:0;display:block;overflow:hidden" referrerpolicy="no-referrer"></iframe></div>';
    $html .= '<script>(function(){var frame=document.getElementById(' . wp_json_encode($iframe_id) . ');var origin=' . wp_json_encode($origin) . ';var prefix=' . wp_json_encode($prefix) . ';window.addEventListener("message",function(event){if(event.origin!==origin||event.source!==frame.contentWindow)return;var data=event.data;if(!data||data.type!=="lirep:resize"||data.prefix!==prefix)return;var height=Number(data.height);if(!Number.isFinite(height)||height<300||height>10000)return;frame.style.height=Math.ceil(height+4)+"px";});})();</script>';
    return $html;
}

// Register the shortcode after defining its callback.
add_shortcode('lirep', 'lirep_shortcode');
