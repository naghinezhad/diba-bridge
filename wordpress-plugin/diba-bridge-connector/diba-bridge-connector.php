<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'DIBA_BRIDGE_VERSION', '1.0.0' );
define( 'DIBA_BRIDGE_DB_VERSION', '1' );
define( 'DIBA_BRIDGE_FILE', __FILE__ );
define( 'DIBA_BRIDGE_DIR', plugin_dir_path( __FILE__ ) );
define( 'DIBA_BRIDGE_REST_NAMESPACE', 'diba-bridge/v1' );
define( 'DIBA_BRIDGE_OPTION', 'diba_bridge_connector_settings' );
define( 'DIBA_BRIDGE_MAINTENANCE_OPTION', 'diba_bridge_connector_maintenance' );
define( 'DIBA_BRIDGE_CRON_HOOK', 'diba_bridge_connector_prune_log' );

require_once DIBA_BRIDGE_DIR . 'includes/class-diba-bridge-settings.php';
require_once DIBA_BRIDGE_DIR . 'includes/class-diba-bridge-audit-log.php';
require_once DIBA_BRIDGE_DIR . 'includes/class-diba-bridge-auth.php';
require_once DIBA_BRIDGE_DIR . 'includes/class-diba-bridge-rest.php';
require_once DIBA_BRIDGE_DIR . 'includes/class-diba-bridge-tools.php';
require_once DIBA_BRIDGE_DIR . 'includes/class-diba-bridge-seo.php';
require_once DIBA_BRIDGE_DIR . 'includes/class-diba-bridge-woocommerce.php';
require_once DIBA_BRIDGE_DIR . 'includes/class-diba-bridge-admin.php';

/**
 * Activation: create the audit table, default settings and the prune schedule.
 */
function diba_bridge_connector_activate() {
	Diba_Bridge_Audit_Log::install();
	if ( false === get_option( DIBA_BRIDGE_OPTION, false ) ) {
		add_option( DIBA_BRIDGE_OPTION, Diba_Bridge_Settings::defaults(), '', false );
	}
	if ( ! wp_next_scheduled( DIBA_BRIDGE_CRON_HOOK ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', DIBA_BRIDGE_CRON_HOOK );
	}
}
register_activation_hook( __FILE__, 'diba_bridge_connector_activate' );

/**
 * Deactivation: stop the schedule. Data is kept until uninstall.
 */
function diba_bridge_connector_deactivate() {
	wp_clear_scheduled_hook( DIBA_BRIDGE_CRON_HOOK );
}
register_deactivation_hook( __FILE__, 'diba_bridge_connector_deactivate' );

/**
 * Bootstrap.
 */
function diba_bridge_connector_init() {
	if ( get_option( 'diba_bridge_connector_db_version' ) !== DIBA_BRIDGE_DB_VERSION ) {
		Diba_Bridge_Audit_Log::install();
	}

	Diba_Bridge_Auth::init();
	Diba_Bridge_Tools::init_maintenance();

	if ( is_admin() ) {
		Diba_Bridge_Admin::init();
	}
}
add_action( 'plugins_loaded', 'diba_bridge_connector_init' );

/**
 * Translations are loaded on `init`, as WordPress expects.
 */
function diba_bridge_connector_load_textdomain() {
	load_plugin_textdomain( 'diba-bridge-connector', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
}
add_action( 'init', 'diba_bridge_connector_load_textdomain' );

add_action( DIBA_BRIDGE_CRON_HOOK, array( 'Diba_Bridge_Audit_Log', 'prune' ) );

/**
 * REST routes. The WooCommerce and SEO modules register routes only while
 * those plugins are active.
 */
function diba_bridge_connector_rest_init() {
	Diba_Bridge_REST::register_routes();
	Diba_Bridge_Tools::register_routes();

	if ( Diba_Bridge_SEO::is_available() ) {
		Diba_Bridge_SEO::register_routes();
	}
	if ( Diba_Bridge_WooCommerce::is_available() ) {
		Diba_Bridge_WooCommerce::register_routes();
	}
}
add_action( 'rest_api_init', 'diba_bridge_connector_rest_init' );

/**
 * Declare compatibility with WooCommerce High-Performance Order Storage:
 * orders are only accessed through the WooCommerce CRUD API.
 */
function diba_bridge_connector_declare_wc_compat() {
	if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
	}
}
add_action( 'before_woocommerce_init', 'diba_bridge_connector_declare_wc_compat' );

/**
 * Settings link on the Plugins screen.
 *
 * @param string[] $links Existing action links.
 * @return string[]
 */
function diba_bridge_connector_action_links( $links ) {
	$url = admin_url( 'options-general.php?page=diba-bridge-connector' );
	array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'تنظیمات', 'diba-bridge-connector' ) . '</a>' );
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'diba_bridge_connector_action_links' );
