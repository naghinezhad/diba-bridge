<?php
/**
 * Uninstall: remove everything the plugin stored.
 *
 * @package DibaBridgeConnector
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Remove options, transients, the cron event and the audit table of one site.
 *
 * @return void
 */
function diba_bridge_connector_uninstall_site() {
	global $wpdb;

	delete_option( 'diba_bridge_connector_settings' );
	delete_option( 'diba_bridge_connector_maintenance' );
	delete_option( 'diba_bridge_connector_db_version' );

	wp_clear_scheduled_hook( 'diba_bridge_connector_prune_log' );

	// Rate-limit counters.
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_diba_bridge_rl_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_diba_bridge_rl_' ) . '%'
		)
	);

	$table = $wpdb->prefix . 'diba_bridge_log';
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange
	$wpdb->query( "DROP TABLE IF EXISTS {$table}" );
}

if ( is_multisite() ) {
	$diba_bridge_site_ids = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	);
	foreach ( $diba_bridge_site_ids as $diba_bridge_site_id ) {
		switch_to_blog( (int) $diba_bridge_site_id );
		diba_bridge_connector_uninstall_site();
		restore_current_blog();
	}
} else {
	diba_bridge_connector_uninstall_site();
}
