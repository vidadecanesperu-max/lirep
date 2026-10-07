<?php
/**
 * Plugin Name: LIREP - Libro de Reclamaciones Virtual Peru
 * Description: Integracion universal del Libro de Reclamaciones LIREP.
 * Version: 1.1.0
 * Author: 360 Integral Solutions
 */

if (!defined('ABSPATH')) exit;

define('LIREP_EMBED_BASE', 'https://lirep-public-api.vidadecanes-peru.workers.dev');

function lirep_register_settings() {
    register_setting('lirep_settings', 'lirep_public_prefix', [
        'type' => 'string',
        'sanitize_callback' => function($value) {
            return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$value));
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
    $atts = shortcode_atts(['prefix' => ''], $atts, 'lirep');
    $prefix = strtoupper(trim($atts['prefix'] ?: get_option('lirep_public_prefix', '')));
    if (!preg_match('/^[A-Z0-9]{8}$/', $prefix)) {
        return '<div style="padding:16px;border:1px solid #ddd;border-radius:10px">LIREP no está configurado. Ingresa el identificador público en Ajustes → LIREP.</div>';
    }

    $src = add_query_arg(['public_prefix' => $prefix, 'embed' => '1'], LIREP_EMBED_BASE . '/libro-de-reclamaciones');
    return '<div class="lirep-container"><iframe src="' . esc_url($src) . '" title="Libro de Reclamaciones" loading="lazy" style="width:100%;min-height:1150px;border:0;display:block" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
}
add_shortcode('lirep', 'lirep_shortcode');
