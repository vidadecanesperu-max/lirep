<?php
// Lightweight WordPress API contract harness; no network or real WordPress instance.
error_reporting(E_ALL);
define('ABSPATH', '/fake/wordpress/');
define('MINUTE_IN_SECONDS', 60);
define('HOUR_IN_SECONDS', 3600);
$GLOBALS['options'] = array();
$GLOBALS['transients'] = array();
$GLOBALS['filters'] = array();
$GLOBALS['shortcodes'] = array();
$GLOBALS['is_admin'] = true;
$GLOBALS['requests'] = 0;
$GLOBALS['downloads'] = 0;
$GLOBALS['asset_content'] = 'LIREP secure release ZIP fixture contents, >= 1000 bytes';
$GLOBALS['remote_releases'] = array();
$GLOBALS['styles'] = array();
$GLOBALS['scripts'] = array();

class WP_Error {
    public $code;
    public $message;
    public function __construct($code, $message) { $this->code = $code; $this->message = $message; }
}
function add_action($name, $cb) { $GLOBALS['filters'][$name][] = $cb; }
function add_filter($name, $cb) { $GLOBALS['filters'][$name][] = $cb; }
function add_shortcode($name, $cb) { $GLOBALS['shortcodes'][$name] = $cb; }
function register_setting() {}
function add_settings_error() {}
function get_option($name, $default = '') { return array_key_exists($name, $GLOBALS['options']) ? $GLOBALS['options'][$name] : $default; }
function get_transient($name) { return $GLOBALS['transients'][$name] ?? false; }
function set_transient($name, $value, $seconds) { $GLOBALS['transients'][$name] = $value; }
function wp_parse_url($value) { return parse_url($value); }
function current_user_can($cap) { return $GLOBALS['is_admin']; }
function wp_unique_id() { static $i = 0; return ++$i; }
function shortcode_atts($defaults, $atts, $shortcode) { return array_merge($defaults, $atts); }
function add_query_arg($args, $url) { return $url . '?' . http_build_query($args); }
function esc_attr($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
function esc_url($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
function esc_html($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
function plugin_basename($file) { return 'lirep/lirep.php'; }
function plugins_url($path, $file) { return 'https://example.com/wp-content/plugins/lirep/' . $path; }
function wp_enqueue_style($name) { $GLOBALS['styles'][$name] = true; }
function wp_enqueue_script($name) { $GLOBALS['scripts'][$name] = true; }
function wp_safe_remote_get($url, $args) { $GLOBALS['requests']++; return array('code' => 200, 'body' => json_encode($GLOBALS['remote_releases'])); }
function wp_remote_retrieve_response_code($response) { return $response['code']; }
function wp_remote_retrieve_body($response) { return $response['body']; }
function is_wp_error($response) { return $response instanceof WP_Error; }
function download_url($url, $timeout) { $GLOBALS['downloads']++; $tmp = tempnam(sys_get_temp_dir(), 'lirep-qa'); file_put_contents($tmp, $GLOBALS['asset_content']); return $tmp; }
function checked() {}
function admin_url($path) { return 'https://example.com/wp-admin/' . $path; }

require dirname(__DIR__) . '/lirep/lirep.php';

$passed = 0;
function qa($condition, $name) {
    global $passed;
    if (!$condition) { fwrite(STDERR, "FAIL | {$name}\n"); exit(1); }
    $passed++;
    echo "PASS | {$name}\n";
}
qa(isset($GLOBALS['shortcodes']['lirep']), 'Shortcode registered');
qa(LIREP_VERSION === '1.7.1', 'Self-service version loaded');
qa(function_exists('lirep_onboarding_ajax') && function_exists('lirep_onboarding_challenge'), 'Self-service endpoints registered');
qa(in_array('lirep_enqueue_assets', $GLOBALS['filters']['wp_enqueue_scripts'], true), 'Frontend assets preloaded');
qa(in_array('lirep_enqueue_assets', $GLOBALS['filters']['elementor/preview/enqueue_scripts'], true), 'Elementor preview assets preloaded');
qa(lirep_valid_prefix(' vidacane ') === 'VIDACANE', 'Tenant normalized');
qa(lirep_valid_prefix('VIDACAN1') === 'VIDACAN1', '8-character prefix');
qa(lirep_valid_prefix('VIDACANE<script>') === '', 'Injection rejected');
qa(lirep_valid_prefix(array('a')) === '', 'Array rejected');
qa(lirep_normalize_worker_base('https://qa.account.workers.dev') === 'https://qa.account.workers.dev', 'QA Worker accepted');
qa(lirep_normalize_worker_base('https://qa.account.workers.dev.evil.test') === '', 'Fake worker rejected');
qa(lirep_normalize_worker_base('http://qa.account.workers.dev') === '', 'Insecure worker rejected');
qa(lirep_normalize_worker_base('https://qa.account.workers.dev/path') === '', 'Worker path rejected');
qa(lirep_normalize_worker_base('https://qa.account.workers.dev:444') === '', 'Worker port rejected');
qa(lirep_sanitize_auto_security('1') === '1' && lirep_sanitize_auto_security('false') === '0', 'Security update opt-in sanitized');
qa(strpos(lirep_shortcode(), 'configura el identificador') !== false, 'Missing tenant fails closed for admin');
$GLOBALS['is_admin'] = false;
qa(strpos(lirep_shortcode(), 'temporalmente') !== false, 'Missing tenant hides admin details from visitors');
qa(strpos(lirep_shortcode(array('entorno' => 'qa')), 'restringida') !== false, 'QA hidden from visitors');
$GLOBALS['is_admin'] = true;
$GLOBALS['options']['lirep_public_prefix'] = 'VIDACANE';
qa(strpos(lirep_shortcode(array('entorno' => 'qa')), 'Worker') !== false, 'QA without worker fails closed');
$GLOBALS['options']['lirep_qa_worker_url'] = 'https://qa.account.workers.dev';
$GLOBALS['options']['lirep_qa_public_prefix'] = 'LIREPQA1';
$qa_html = lirep_shortcode(array('entorno' => 'qa'));
qa(strpos($qa_html, 'https://qa.account.workers.dev') !== false && strpos($qa_html, 'LIREPQA1') !== false, 'QA uses separate endpoint');
$prod_html = lirep_shortcode(array('public_prefix' => 'EVIL0000', 'entorno' => 'produccion'));
qa(strpos($prod_html, 'VIDACANE') !== false && strpos($prod_html, 'EVIL0000') === false, 'Shortcode cannot override tenant');
qa(strpos($prod_html, 'data-lirep-origin') !== false && strpos($prod_html, '<script>') === false, 'External script and origin metadata');
qa(strpos($prod_html, 'rel="noopener noreferrer"') !== false, 'Safe fallback external link');
qa(isset($GLOBALS['styles']['lirep-embed']) && isset($GLOBALS['scripts']['lirep-embed']), 'Assets enqueued');
qa(lirep_shortcode() !== $prod_html, 'Unique frame IDs');

$tag = 'lirep-wp-v1.7.2';
$url = 'https://github.com/vidadecanesperu-max/lirep/releases/download/' . $tag . '/lirep.zip';
$digest = hash('sha256', $GLOBALS['asset_content']);
$release = array('tag_name' => $tag, 'draft' => false, 'prerelease' => false, 'body' => '[LIREP-SECURITY] Fix', 'assets' => array(array('name' => 'lirep.zip', 'browser_download_url' => $url, 'digest' => 'sha256:' . $digest, 'size' => 1500)));
qa(lirep_valid_release($release)['security'] === true, 'Security release classification');
$malicious = $release; $malicious['assets'][0]['browser_download_url'] = 'https://evil.test/plugin.zip';
qa(lirep_valid_release($malicious) === null, 'Release host/path pinned');
$nohash = $release; unset($nohash['assets'][0]['digest']);
qa(lirep_valid_release($nohash) === null, 'Release without SHA256 rejected');
$prerelease = $release; $prerelease['prerelease'] = true;
qa(lirep_valid_release($prerelease) === null, 'Prerelease rejected');
$wrongtag = $release; $wrongtag['tag_name'] = 'v1.7.2';
qa(lirep_valid_release($wrongtag) === null, 'Unrelated release rejected');
$GLOBALS['remote_releases'] = array($release);
$info = lirep_release_info();
qa($info['version'] === '1.7.2' && $GLOBALS['requests'] === 1, 'Release discovered');
qa(lirep_release_info()['sha256'] === $digest && $GLOBALS['requests'] === 1, 'Release cached');
qa(lirep_update_plugins_github('unchanged', array(), 'another/plugin.php', array()) === 'unchanged', 'Other GitHub plugins unaffected');
$update = lirep_update_plugins_github(null, array(), 'lirep/lirep.php', array());
qa($update['version'] === '1.7.2' && $update['package'] === $url && $update['lirep_security'], 'WordPress update metadata');
qa(lirep_upgrader_pre_download(false, 'https://example.org/plugin.zip', null, array()) === false, 'Other package downloads unaffected');
$download = lirep_upgrader_pre_download(false, $url, null, array());
qa(is_string($download) && file_exists($download) && hash_file('sha256', $download) === $digest, 'Verified SHA256 download');
unlink($download);
$GLOBALS['asset_content'] = 'Tampered release';
$error = lirep_upgrader_pre_download(false, $url, null, array());
qa($error instanceof WP_Error && $error->code === 'lirep_update_hash_mismatch', 'Tampered ZIP blocked');
$item = (object) array('plugin' => 'lirep/lirep.php', 'lirep_security' => true);
qa(lirep_auto_update_plugin(false, $item) === false, 'Automatic security updates disabled by default');
$GLOBALS['options']['lirep_auto_security_updates'] = '1';
qa(lirep_auto_update_plugin(false, $item) === true, 'Automatic security updates opt-in');
qa(lirep_auto_update_plugin(false, (object) array('plugin' => 'another/plugin.php', 'lirep_security' => true)) === false, 'No changes to other plugin auto-updates');
qa(lirep_auto_update_plugin(false, (object) array('plugin' => 'lirep/lirep.php', 'lirep_security' => false)) === false, 'Nonsecurity updates not forced');
echo "LIREP QA PLUGIN: {$passed}/{$passed} PASS\n";
