<?php
/**
 * LIREP automatic WordPress publishing and responsive shell.
 * Include from the main LIREP plugin after its shortcode is registered.
 * Does not provision tenants, change Cloudflare, or modify complaint records.
 */
if (!defined('ABSPATH')) { exit; }

function lirep_auto_page_slug() { return 'libro-de-reclamaciones'; }

function lirep_auto_sync_page() {
    if (!current_user_can('manage_options')) { return; }
    if (!function_exists('lirep_valid_prefix')) { return; }
    $prefix = lirep_valid_prefix(get_option('lirep_public_prefix', ''));
    if (!$prefix) { return; }
    $slug = lirep_auto_page_slug();
    $existing = get_page_by_path($slug, OBJECT, 'page');
    $stored = absint(get_option('lirep_auto_page_id', 0));
    if ($existing) {
        // Never overwrite user-authored pages or duplicate an existing slug.
        if ($stored !== (int) $existing->ID) {
            if (has_shortcode($existing->post_content, 'lirep')) {
                update_option('lirep_auto_page_id', (int) $existing->ID, false);
            }
        }
        return;
    }
    // Do not recreate pages deliberately trashed by the administrator.
    if ($stored && get_post_status($stored) === 'trash') { return; }
    $id = wp_insert_post(array(
        'post_type' => 'page',
        'post_status' => 'publish',
        'post_title' => 'Libro de Reclamaciones',
        'post_name' => $slug,
        'post_content' => '[lirep]',
        'comment_status' => 'closed',
        'ping_status' => 'closed',
    ), true);
    if (!is_wp_error($id)) {
        update_option('lirep_auto_page_id', (int) $id, false);
    }
}
add_action('update_option_lirep_public_prefix', function($old, $new) {
    if ($old !== $new) { lirep_auto_sync_page(); }
}, 10, 2);
add_action('admin_init', function() {
    if (current_user_can('manage_options') && get_option('lirep_public_prefix', '')) {
        lirep_auto_sync_page();
    }
}, 30);

function lirep_auto_is_public_page() {
    if (!is_page()) { return false; }
    $id = get_queried_object_id();
    $stored = absint(get_option('lirep_auto_page_id', 0));
    return $id && ($id === $stored || get_post_field('post_name', $id) === lirep_auto_page_slug());
}

add_action('wp_head', function() {
    if (!lirep_auto_is_public_page()) { return; }
    echo '<style id="lirep-auto-responsive">
    body .lirep-container { width:100%!important;max-width:none!important;margin:0 auto!important; }
    body .lirep-container .lirep-frame {display:block;width:100%!important;max-width:none!important;min-height:1200px;border:0;}
    body .entry-content:has(.lirep-container),body .wp-block-post-content:has(.lirep-container) {width:100%!important;max-width:1200px!important;margin-left:auto!important;margin-right:auto!important;}
    body .elementor-widget-container:has(.lirep-container) {width:100%!important;max-width:none!important;}
    @media(max-width:767px){body .entry-content:has(.lirep-container),body .wp-block-post-content:has(.lirep-container){padding-inline:12px!important}body .lirep-container .lirep-frame{min-height:1450px}}
    </style>';
}, 30);
