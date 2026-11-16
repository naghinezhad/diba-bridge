<?php
/**
 * Audit log stored in a custom table.
 *
 * @package DibaBridgeConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Records every request made with the connector key.
 */
class Diba_Bridge_Audit_Log {

	const MAX_ROWS = 20000;

	/**
	 * Table name (prefix comes from $wpdb, never from user input).
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'diba_bridge_log';
	}

	/**
	 * Create or upgrade the table.
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table   = self::table();
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			created_at datetime NOT NULL DEFAULT '0000-00-00 00:00:00',
			user_id bigint(20) unsigned NOT NULL DEFAULT 0,
			ip varchar(45) NOT NULL DEFAULT '',
			method varchar(10) NOT NULL DEFAULT '',
			route varchar(191) NOT NULL DEFAULT '',
			status smallint(5) unsigned NOT NULL DEFAULT 0,
			details text NULL,
			PRIMARY KEY  (id),
			KEY created_at (created_at),
			KEY status (status)
		) {$charset};";

		dbDelta( $sql );
		update_option( 'diba_bridge_connector_db_version', DIBA_BRIDGE_DB_VERSION, false );
	}

	/**
	 * Drop the table (uninstall).
	 *
	 * @return void
	 */
	public static function uninstall() {
		global $wpdb;
		$table = self::table();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
		$wpdb->query( "DROP TABLE IF EXISTS {$table}" );
	}

	/**
	 * Insert one row.
	 *
	 * @param string $method  HTTP method.
	 * @param string $route   REST route.
	 * @param int    $status  HTTP status.
	 * @param string $details Short free-text details (no secrets).
	 * @return void
	 */
	public static function add( $method, $route, $status, $details = '' ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$wpdb->insert(
			self::table(),
			array(
				'created_at' => current_time( 'mysql', true ),
				'user_id'    => get_current_user_id(),
				'ip'         => substr( Diba_Bridge_Auth::client_ip(), 0, 45 ),
				'method'     => substr( sanitize_text_field( (string) $method ), 0, 10 ),
				'route'      => substr( sanitize_text_field( (string) $route ), 0, 191 ),
				'status'     => absint( $status ),
				'details'    => substr( sanitize_text_field( (string) $details ), 0, 500 ),
			),
			array( '%s', '%d', '%s', '%s', '%s', '%d', '%s' )
		);
	}

	/**
	 * Query rows, newest first.
	 *
	 * @param array<string,mixed> $args page, per_page, status (all|ok|error).
	 * @return array{items:array<int,array<string,mixed>>,total:int}
	 */
	public static function query( array $args = array() ) {
		global $wpdb;
		$table    = self::table();
		$per_page = isset( $args['per_page'] ) ? max( 1, min( 100, absint( $args['per_page'] ) ) ) : 20;
		$page     = isset( $args['page'] ) ? max( 1, absint( $args['page'] ) ) : 1;
		$offset   = ( $page - 1 ) * $per_page;
		$status   = isset( $args['status'] ) ? (string) $args['status'] : 'all';

		// Status boundaries are passed as placeholders so every query is prepared.
		$min = 0;
		$max = 999;
		if ( 'ok' === $status ) {
			$max = 399;
		} elseif ( 'error' === $status ) {
			$min = 400;
		}

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
		$total = (int) $wpdb->get_var(
			$wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE status BETWEEN %d AND %d", $min, $max )
		);
		$rows  = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, created_at, user_id, ip, method, route, status, details FROM {$table} WHERE status BETWEEN %d AND %d ORDER BY id DESC LIMIT %d OFFSET %d",
				$min,
				$max,
				$per_page,
				$offset
			),
			ARRAY_A
		);
		// phpcs:enable

		$items = array();
		foreach ( (array) $rows as $row ) {
			$items[] = array(
				'id'      => (int) $row['id'],
				'time'    => str_replace( ' ', 'T', (string) $row['created_at'] ) . 'Z',
				'user_id' => (int) $row['user_id'],
				'ip'      => (string) $row['ip'],
				'method'  => (string) $row['method'],
				'route'   => (string) $row['route'],
				'status'  => (int) $row['status'],
				'details' => (string) $row['details'],
			);
		}

		return array(
			'items' => $items,
			'total' => $total,
		);
	}

	/**
	 * Daily cleanup: remove rows older than the retention period and cap the table size.
	 *
	 * @return void
	 */
	public static function prune() {
		global $wpdb;
		$table    = self::table();
		$settings = Diba_Bridge_Settings::get();
		$cutoff   = gmdate( 'Y-m-d H:i:s', time() - ( (int) $settings['log_retention'] * DAY_IN_SECONDS ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE created_at < %s", $cutoff ) );

		$boundary = (int) $wpdb->get_var(
			$wpdb->prepare( "SELECT id FROM {$table} ORDER BY id DESC LIMIT 1 OFFSET %d", self::MAX_ROWS )
		);
		if ( $boundary > 0 ) {
			$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE id <= %d", $boundary ) );
		}
		// phpcs:enable
	}

	/**
	 * Remove every row.
	 *
	 * @return void
	 */
	public static function clear() {
		global $wpdb;
		$table = self::table();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE id > %d", 0 ) );
	}
}
