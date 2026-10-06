<?php
/**
 * Plugin Name: LIREP — Libro de Reclamaciones Perú
 * Description: Integra LIREP con WordPress y Elementor Free. Los reclamos se almacenan en LIREP, no en WordPress.
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 */
if (!defined('ABSPATH')) exit;
define('LIREP_VERSION','1.0.0');
function lirep_register_settings(){register_setting('lirep_settings','lirep_public_url',['type'=>'string','sanitize_callback'=>'esc_url_raw','default'=>'']);}
add_action('admin_init','lirep_register_settings');
function lirep_admin_menu(){add_options_page('LIREP','LIREP','manage_options','lirep','lirep_settings_page');}
add_action('admin_menu','lirep_admin_menu');
function lirep_settings_page(){if(!current_user_can('manage_options'))return; ?>
<div class="wrap"><h1>LIREP</h1><p>Configura la URL pública asignada a esta empresa o establecimiento.</p><form method="post" action="options.php"><?php settings_fields('lirep_settings'); ?><table class="form-table"><tr><th><label for="lirep_public_url">URL pública LIREP</label></th><td><input class="regular-text" type="url" id="lirep_public_url" name="lirep_public_url" value="<?php echo esc_attr(get_option('lirep_public_url','')); ?>" placeholder="https://libro.ejemplo.pe/empresa"></td></tr></table><?php submit_button(); ?></form><p>Elementor Free: usa el widget Shortcode con <code>[lirep]</code>.</p></div><?php }
function lirep_shortcode($atts=[]){$atts=shortcode_atts(['height'=>'900','title'=>'Libro de Reclamaciones'],$atts,'lirep');$url=get_option('lirep_public_url','');if(!$url)return current_user_can('manage_options')?'<p>LIREP: configura la URL pública en Ajustes → LIREP.</p>':'';$height=max(500,min(2000,absint($atts['height'])));return sprintf('<div class="lirep-embed" style="width:100%%"><iframe src="%s" title="%s" loading="lazy" style="width:100%%;height:%dpx;border:0;display:block" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>',esc_url($url),esc_attr($atts['title']),$height);}
add_shortcode('lirep','lirep_shortcode');
