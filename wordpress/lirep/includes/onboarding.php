<?php
/**
 * LIREP v1.7.7 — WordPress self-service onboarding.
 * No Supabase keys, platform credentials or service-role secrets are stored here.
 */
if (!defined('ABSPATH')) { exit; }

function lirep_onboarding_menu() {
    remove_submenu_page('options-general.php', 'lirep');
    add_options_page('LIREP — Activación', 'LIREP', 'manage_options', 'lirep', 'lirep_onboarding_page');
}
add_action('admin_menu', 'lirep_onboarding_menu', 99);

function lirep_onboarding_challenge() {
    $state = get_option('lirep_onboarding_state', array());
    $challenge = is_array($state) && isset($state['challenge']) ? (string) $state['challenge'] : '';
    if (!preg_match('/^[a-f0-9]{64}$/D', $challenge)) {
        return new WP_Error('lirep_not_pending', 'No hay activación pendiente.', array('status' => 404));
    }
    return new WP_REST_Response(array('challenge' => $challenge), 200, array('Cache-Control' => 'no-store'));
}
function lirep_onboarding_register_rest() {
    register_rest_route('lirep/v1', '/challenge', array(
        'methods' => 'GET',
        'callback' => 'lirep_onboarding_challenge',
        'permission_callback' => '__return_true',
    ));
}
add_action('rest_api_init', 'lirep_onboarding_register_rest');

/**
 * Fail closed until the official backend explicitly advertises onboarding readiness.
 * This prevents collecting company data when the service is not operational.
 */
function lirep_onboarding_is_ready() {
    $cache = get_transient('lirep_onboarding_ready_v171');
    if ('yes' === $cache) { return true; }
    if ('no' === $cache) { return false; }
    $response = wp_safe_remote_get(LIREP_PROD_BASE . '/api/v1/onboarding/capabilities', array(
        'timeout' => 7, 'redirection' => 0, 'limit_response_size' => 1024,
        'headers' => array('Accept' => 'application/json'),
    ));
    $ready = false;
    if (!is_wp_error($response) && 200 === (int) wp_remote_retrieve_response_code($response)) {
        $data = json_decode(wp_remote_retrieve_body($response), true);
        $ready = is_array($data) && !empty($data['ok']) && true === ($data['enabled'] ?? false);
    }
    set_transient('lirep_onboarding_ready_v171', $ready ? 'yes' : 'no', 5 * MINUTE_IN_SECONDS);
    return $ready;
}

/** Friendly, actionable errors for self-service company administrators. */
function lirep_onboarding_error_message($reason) {
    $messages = array(
        'onboarding_not_enabled' => 'El registro autónomo todavía no está disponible. El plugin está instalado correctamente.',
        'onboarding_not_configured' => 'La activación todavía no está disponible. Inténtalo más tarde.',
        'review_required' => 'La empresa o el dominio ya figuran en LIREP con otros datos. Por seguridad, esta vinculación necesita revisión.',
        'invalid_domain' => 'No se pudo validar el dominio HTTPS de WordPress.',
        'invalid_input' => 'Revisa el RUC, los datos de la empresa y la dirección de la política de privacidad.',
        'domain_challenge_failed' => 'No se pudo verificar el dominio. Comprueba que la API REST de WordPress funcione por HTTPS y no esté bloqueada por un plugin de seguridad.',
        'email_rate_limited' => 'Ya se solicitó la verificación. Espera dos minutos y revisa el correo no deseado antes de reintentar.',
        'invalid_token' => 'La solicitud de activación ya no es válida. Reinicia el registro.',
        'expired' => 'La solicitud caducó. Reinicia el registro desde Ajustes → LIREP.',
        'rate_limited' => 'Demasiados intentos. Espera un momento antes de continuar.',
    );
    return isset($messages[$reason]) ? $messages[$reason] :
        'El servicio de activación está temporalmente no disponible. Inténtalo más tarde.';
}

function lirep_onboarding_call($route, $payload) {
    $allowed = array('start', 'status', 'verify-domain', 'cancel');
    if (!in_array($route, $allowed, true)) {
        return new WP_Error('lirep_invalid_route', 'Operación no permitida.');
    }
    $response = wp_remote_post(LIREP_PROD_BASE . '/api/v1/onboarding/' . $route, array(
        'timeout' => 'status' === $route ? 8 : 30,
        'redirection' => 0,
        'sslverify' => true,
        'headers' => array('Content-Type' => 'application/json', 'Accept' => 'application/json'),
        'body' => wp_json_encode($payload),
        'limit_response_size' => 8192,
    ));
    if (is_wp_error($response)) { return $response; }
    $result = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($result) || empty($result['ok'])) {
        $reason = is_array($result) && isset($result['error']) ? sanitize_key($result['error']) : 'service_unavailable';
        return new WP_Error('lirep_' . $reason, lirep_onboarding_error_message($reason));
    }
    return $result;
}

/**
 * QA256: activar el prefijo local únicamente si LIREP confirma la activación.
 * La página WordPress se recupera automáticamente al volver del correo.
 * Nunca se confía en datos proporcionados por el navegador para el prefijo.
 */
function lirep_onboarding_apply_verified_status($status) {
    if (!is_array($status) || ($status['state'] ?? '') !== 'active'
        || empty($status['invitation_sent'])) { return false; }
    $prefix = lirep_valid_prefix($status['public_prefix'] ?? '');
    if ('' === $prefix) { return false; }
    update_option('lirep_public_prefix', $prefix, false);
    if (get_option('lirep_public_prefix', '') !== $prefix) { return false; }
    delete_option('lirep_onboarding_state');
    return true;
}

/** Sin botones manuales ni reenvíos: sincroniza en Ajustes > LIREP. */
function lirep_onboarding_sync_on_admin_open() {
    if (!is_admin() || !current_user_can('manage_options')
        || !isset($_GET['page']) || sanitize_key(wp_unslash($_GET['page'])) !== 'lirep') { return; }
    if (lirep_valid_prefix(get_option('lirep_public_prefix', '')) !== '') { return; }
    $pending = get_option('lirep_onboarding_state', array());
    if (!is_array($pending) || empty($pending['id']) || empty($pending['status_token'])) { return; }
    $host = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
    if (empty($pending['domain']) || strtolower((string) $pending['domain']) !== $host) { return; }
    $result = lirep_onboarding_call('status', array(
        'id' => $pending['id'], 'status_token' => $pending['status_token'],
    ));
    if (is_wp_error($result)) { return; } // Sin cambios destructivos si falla la red.
    lirep_onboarding_apply_verified_status($result['state'] ?? array());
}
add_action('admin_init', 'lirep_onboarding_sync_on_admin_open', 20);

function lirep_onboarding_ajax() {
    if (!current_user_can('manage_options')) {
        wp_send_json_error(array('message' => 'Acceso no autorizado.'), 403);
    }
    check_ajax_referer('lirep_onboarding_v171', 'nonce');
    $action = isset($_POST['operation']) ? sanitize_key(wp_unslash($_POST['operation'])) : '';
    $state = get_option('lirep_onboarding_state', array());
    if (!is_array($state)) { $state = array(); }

    if ('start' === $action) {
        if (!lirep_onboarding_is_ready()) {
            wp_send_json_error(array('message' => 'El registro autónomo de LIREP todavía no está habilitado. Inténtalo cuando el servicio esté disponible.'), 503);
        }
        if (lirep_valid_prefix(get_option('lirep_public_prefix', ''))) {
            wp_send_json_error(array('message' => 'Esta instalación ya está vinculada a LIREP.'), 409);
        }
        if (!empty($state['id'])) {
            wp_send_json_error(array('message' => 'Hay una activación pendiente. Comprueba su estado o reiníciala.'), 409);
        }
        $domain = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
        $challenge_url = rest_url('lirep/v1/challenge');
        $keys = array('ruc','legal_name','trade_name','contact_email','address','district','province','department','privacy_policy_url');
        $payload = array('domain' => $domain, 'challenge_url' => $challenge_url);
        foreach ($keys as $key) {
            $value = isset($_POST[$key]) && is_scalar($_POST[$key]) ? wp_unslash($_POST[$key]) : '';
            if ('contact_email' === $key) {
                $payload[$key] = sanitize_email($value);
            } elseif ('privacy_policy_url' === $key) {
                $payload[$key] = esc_url_raw($value);
            } else {
                $payload[$key] = sanitize_text_field($value);
            }
        }
        if (!preg_match('/^[0-9]{11}$/D', $payload['ruc']) || !is_email($payload['contact_email'])) {
            wp_send_json_error(array('message' => 'Comprueba el RUC de 11 dígitos y el correo electrónico.'), 400);
        }
        if (!isset($_POST['consent']) || '1' !== (string) $_POST['consent']) {
            wp_send_json_error(array('message' => 'Debes confirmar la declaración de responsabilidad.'), 400);
        }
        $result = lirep_onboarding_call('start', $payload);
        if (is_wp_error($result)) {
            wp_send_json_error(array('message' => $result->get_error_message()), 503);
        }
        $new_state = array(
            'id' => sanitize_text_field($result['id']),
            'status_token' => sanitize_text_field($result['status_token']),
            'challenge' => sanitize_text_field($result['challenge']),
            'email' => $payload['contact_email'],
            'domain' => $domain,
        );
        update_option('lirep_onboarding_state', $new_state, false);
        wp_send_json_success(array('message' => 'Solicitud preparada. Ahora pulsa «Verificar dominio y continuar»; después recibirás un enlace de correo.'));
    }

    if (!in_array($action, array('status','verify-domain','cancel'), true) ||
        empty($state['id']) || empty($state['status_token'])) {
        wp_send_json_error(array('message' => 'No existe una activación pendiente.'), 400);
    }
    $payload = array('id' => $state['id'], 'status_token' => $state['status_token']);
    if ('verify-domain' === $action) {
        $payload['challenge_url'] = rest_url('lirep/v1/challenge');
    }
    $result = lirep_onboarding_call($action, $payload);
    if (is_wp_error($result)) {
        wp_send_json_error(array('message' => $result->get_error_message()), 503);
    }
    if ('cancel' === $action) {
        delete_option('lirep_onboarding_state');
        wp_send_json_success(array('message' => 'Activación anterior cancelada. Puedes comenzar nuevamente.'));
    }
    $status = isset($result['state']) && is_array($result['state']) ? $result['state'] : array();
    lirep_onboarding_apply_verified_status($status);
    wp_send_json_success(array(
        'notice' => isset($result['notice']) ? sanitize_key($result['notice']) : '',
        'state' => isset($status['state']) ? sanitize_key($status['state']) : 'pending',
        'email_verified' => !empty($status['email_verified']),
        'domain_verified' => !empty($status['domain_verified']),
        'invitation_sent' => !empty($status['invitation_sent']),
        'public_prefix' => isset($status['public_prefix']) ? lirep_valid_prefix($status['public_prefix']) : '',
        'message' => 'Estado consultado correctamente.',
    ));
}
add_action('wp_ajax_lirep_onboarding', 'lirep_onboarding_ajax');

function lirep_onboarding_assets($hook) {
    if ('settings_page_lirep' !== $hook) { return; }
    wp_enqueue_style('lirep-onboarding', plugins_url('assets/css/lirep-onboarding.css', dirname(__DIR__) . '/lirep.php'), array(), LIREP_VERSION);
    wp_enqueue_script('lirep-qr-vendor', plugins_url('assets/js/vendor/qrcodegen.min.js', dirname(__DIR__) . '/lirep.php'), array(), LIREP_VERSION, true);
    wp_enqueue_script('lirep-material', plugins_url('assets/js/lirep-material.js', dirname(__DIR__) . '/lirep.php'), array('lirep-qr-vendor'), LIREP_VERSION, true);
    wp_enqueue_script('lirep-onboarding', plugins_url('assets/js/lirep-onboarding.js', dirname(__DIR__) . '/lirep.php'), array(), LIREP_VERSION, true);
    wp_localize_script('lirep-onboarding', 'LIREP_SETUP', array(
        'ajax' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('lirep_onboarding_v171'),
    ));
}

add_action('admin_enqueue_scripts', 'lirep_onboarding_assets');

function lirep_onboarding_page() {
    if (!current_user_can('manage_options')) { return; }
    $prefix = lirep_valid_prefix(get_option('lirep_public_prefix', ''));
    $state = get_option('lirep_onboarding_state', array());
    $pending = !$prefix && is_array($state) && !empty($state['id']);
    $domain = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
    $privacy = get_privacy_policy_url();
    $ready = $prefix || $pending ? true : lirep_onboarding_is_ready();
    ?>
    <div class="wrap lirep-setup">
      <div class="lirep-setup-head">
        <div><p class="lirep-kicker">360 INTEGRAL SOLUTIONS · LIREP <?php echo esc_html(LIREP_VERSION); ?></p>
          <h1>Libro de Reclamaciones</h1>
          <p>Activación autónoma y segura para WordPress y Elementor.</p></div>
        <span class="lirep-state"><?php echo $prefix ? 'Activo' : ($pending ? 'Verificación pendiente' : 'Sin activar'); ?></span>
      </div>
      <?php if ($prefix) : ?>
        <section class="lirep-panel">
          <h2>Tu Libro de Reclamaciones está vinculado</h2>
          <p>Identificador asignado: <strong><?php echo esc_html($prefix); ?></strong></p>
          <p>Dominio de WordPress: <code><?php echo esc_html($domain); ?></code></p>
          <p>Inserta <code>[lirep]</code> en una página, entrada o widget Shortcode de Elementor.</p>
          <?php
          // QA253: enlazar exclusivamente a la página pública de este WordPress,
          // sin sacar al consumidor al endpoint técnico del Worker.
          $public_page = get_page_by_path('libro-de-reclamaciones', OBJECT, 'page');
          // QA258: never create a printable QR for a published page without LIREP.
          // Elementor stores widget shortcode markup in _elementor_data.
          $has_lirep = false;
          if ($public_page && 'publish' === $public_page->post_status) {
              $post_content = (string) $public_page->post_content;
              $elementor_data = (string) get_post_meta($public_page->ID, '_elementor_data', true);
              $has_lirep = has_shortcode($post_content, 'lirep') ||
                  false !== strpos($elementor_data, '[lirep]');
          }
          $public_url = $has_lirep ? get_permalink($public_page) : '';
          // Only a URL on this WordPress installation; no external or administrative URLs.
          $public_host = $public_url ? wp_parse_url($public_url, PHP_URL_HOST) : '';
          if (!$public_url || 'https' !== wp_parse_url($public_url, PHP_URL_SCHEME) ||
              strtolower((string) $public_host) !== strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST))) {
              $public_url = '';
          }
          $company_name = get_bloginfo('name');
          if (!is_string($company_name) || '' === trim($company_name)) { $company_name = $domain; }
          ?>
          <?php if ($public_url) : ?>
            <p><a href="<?php echo esc_url($public_url); ?>" target="_blank" rel="noopener noreferrer">Abrir formulario</a></p>
          <?php else : ?>
            <p class="description">Publica una página «Libro de Reclamaciones» con el shortcode [lirep] para habilitar el enlace público.</p>
          <?php endif; ?>
          <section class="lirep-material" id="lirep-material"
            data-public-url="<?php echo esc_attr($public_url); ?>"
            data-prefix="<?php echo esc_attr($prefix); ?>"
            data-company="<?php echo esc_attr($company_name); ?>">
            <h3>Material institucional del Libro de Reclamaciones</h3>
            <p>QR y aviso blanco estándar para recepción. Se preparan automáticamente cuando publiques la página con <code>[lirep]</code>.</p>
            <?php if ($public_url) : ?>
              <p>Destino del QR: <a href="<?php echo esc_url($public_url); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html($public_url); ?></a></p>
            <?php else : ?>
              <p class="description">Pendiente de publicación: crea la página <strong>libro-de-reclamaciones</strong>, inserta <code>[lirep]</code> y publícala con HTTPS. No exhibas un QR antes de comprobar el formulario.</p>
            <?php endif; ?>
            <p data-material-status role="status">Preparando el material…</p>
            <img data-material-preview hidden alt="Vista previa del aviso institucional A4" class="lirep-material-preview" />
            <div class="lirep-actions">
              <button type="button" class="button" data-material-download="qr-png" disabled>Descargar QR PNG</button>
              <button type="button" class="button" data-material-download="qr-svg" disabled>Descargar QR SVG</button>
              <button type="button" class="button" data-material-download="poster-png" disabled>Descargar aviso PNG</button>
              <button type="button" class="button button-primary" data-material-download="poster-pdf" disabled>Descargar aviso PDF A4</button>
            </div>
            <p class="description">El QR es exclusivo de esta instalación. Si cambias la dirección pública, vuelve a descargar los materiales. Antes de colocarlos en recepción, abre el formulario escaneando el QR con un teléfono.</p>
          </section>
          <p><a class="button button-primary" href="<?php echo esc_url('https://lirep.360insol.com/?public_prefix=' . rawurlencode($prefix)); ?>" target="_blank" rel="noopener noreferrer">Administrar reclamaciones</a></p>
          <p class="description">Acceso administrativo exclusivo para usuarios autorizados. La activación requiere confirmar el correo de la empresa.</p>
        </section>
      <?php elseif ($pending) : ?>
        <section class="lirep-panel" id="lirep-pending">
          <h2>Verifica el dominio y después el correo</h2>
          <p>Primero verifica el dominio. Después enviaremos un enlace a <strong><?php echo esc_html($state['email']); ?></strong>.</p>
          <p>Dominio por verificar: <code><?php echo esc_html($domain); ?></code></p>
          <div class="lirep-actions">
            <button type="button" class="button button-primary" id="lirep-status">Comprobar estado</button>
            <button type="button" class="button" id="lirep-verify">Verificar dominio y continuar</button>
            <button type="button" class="button" id="lirep-cancel">Reiniciar activación</button>
          </div>
          <p id="lirep-progress" role="status">Pendiente de verificación de dominio.</p>
        </section>
      <?php elseif (!$ready) : ?>
        <section class="lirep-panel">
          <h2>No se pudo conectar con el servicio de activación</h2>
          <p>El plugin está instalado, pero el servicio central no confirmó la disponibilidad del registro autónomo. No se enviarán datos hasta que la conexión esté disponible.</p>
          <p>Esta pantalla habilitará el formulario automáticamente cuando el servicio oficial esté disponible.</p>
        </section>
      <?php else : ?>
        <section class="lirep-panel">
          <h2>Registrar mi empresa</h2>
          <p>Completa los datos legales. LIREP asignará el identificador automáticamente.</p>
          <form id="lirep-start-form">
            <div class="lirep-form-grid">
              <label>Dominio detectado<input type="text" value="<?php echo esc_attr($domain); ?>" disabled></label>
              <label>RUC (11 dígitos)<input name="ruc" inputmode="numeric" pattern="[0-9]{11}" maxlength="11" required></label>
              <label>Razón social<input name="legal_name" maxlength="200" required></label>
              <label>Nombre comercial<input name="trade_name" maxlength="200"></label>
              <label>Correo del responsable (editable)<input name="contact_email" type="email" maxlength="254" autocomplete="email" placeholder="responsable@empresa.com" value="<?php echo esc_attr(get_option('admin_email')); ?>" required><small>Puede ser diferente del correo de WordPress. Aquí se enviará la confirmación y el acceso administrativo.</small></label>
              <label>Dirección del establecimiento<input name="address" maxlength="300" required></label>
              <label>Distrito<input name="district" maxlength="100" required></label>
              <label>Provincia<input name="province" maxlength="100" required></label>
              <label>Departamento<input name="department" maxlength="100" required></label>
              <label>URL de la política de privacidad<input name="privacy_policy_url" type="url" pattern="https://.*" value="<?php echo esc_attr($privacy); ?>" required></label>
            </div>
            <label class="lirep-consent"><input name="consent" type="checkbox" value="1" required>
              Declaro que tengo autorización para registrar esta empresa y administrar este dominio.</label>
            <button type="submit" class="button button-primary button-hero">Iniciar registro seguro</button>
          </form>
        </section>
      <?php endif; ?>
      <section class="lirep-panel">
        <h2>Publicación y actualizaciones</h2>
        <p>WordPress, Gutenberg y Elementor Free/Pro: utiliza <code>[lirep]</code>. No introduzcas claves de Supabase.</p>
        <form action="options.php" method="post">
          <?php settings_fields('lirep_settings'); ?>
          <input type="hidden" name="lirep_public_prefix" value="<?php echo esc_attr($prefix); ?>">
          <input type="hidden" name="lirep_qa_public_prefix" value="<?php echo esc_attr(get_option('lirep_qa_public_prefix','LIREPQA1')); ?>">
          <input type="hidden" name="lirep_qa_worker_url" value="<?php echo esc_attr(get_option('lirep_qa_worker_url','')); ?>">
          <input type="hidden" name="lirep_auto_security_updates" value="0">
          <label><input type="checkbox" name="lirep_auto_security_updates" value="1" <?php checked(get_option('lirep_auto_security_updates','0'), '1'); ?>>
            Instalar automáticamente las actualizaciones de seguridad oficiales verificadas.</label>
          <?php submit_button('Guardar preferencia de actualizaciones', 'secondary'); ?>
        </form>
      </section>
      <div id="lirep-dialog" class="lirep-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="lirep-dialog-title">
        <div class="lirep-dialog-card"><h2 id="lirep-dialog-title">LIREP</h2>
          <p id="lirep-dialog-message"></p><button type="button" class="button button-primary" id="lirep-dialog-close">Entendido</button>
        </div>
      </div>
    </div>
    <?php
}
