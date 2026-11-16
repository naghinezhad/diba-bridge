<?php
/**
 * Settings storage and API key handling.
 *
 * @package DibaBridgeConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Reads and writes the connector settings. The API key itself is never stored:
 * only a keyed hash (HMAC-SHA256 with the site's auth salt) is kept.
 */
class Diba_Bridge_Settings {

	/**
	 * Scope slugs (no translation, safe to call before `init`).
	 *
	 * @return string[]
	 */
	public static function scope_slugs() {
		return array( 'content', 'media', 'users', 'plugins', 'options', 'woocommerce', 'tools' );
	}

	/**
	 * All scopes an administrator can toggle, with labels.
	 *
	 * @return array<string,string> slug => label
	 */
	public static function scopes() {
		return array(
			'content'     => __( 'محتوا (نوشته‌ها، برگه‌ها، دسته‌ها، دیدگاه‌ها، فهرست‌ها، سئو)', 'diba-bridge-connector' ),
			'media'       => __( 'رسانه (کتابخانه و آپلود)', 'diba-bridge-connector' ),
			'users'       => __( 'کاربران', 'diba-bridge-connector' ),
			'plugins'     => __( 'افزونه‌ها و پوسته‌ها', 'diba-bridge-connector' ),
			'options'     => __( 'تنظیمات و گزینه‌ها', 'diba-bridge-connector' ),
			'woocommerce' => __( 'ووکامرس (محصولات، سفارش‌ها، مشتریان، کد تخفیف)', 'diba-bridge-connector' ),
			'tools'       => __( 'ابزارها (کش، کرون، جستجو و جایگزینی، حالت تعمیرات، سلامت سایت)', 'diba-bridge-connector' ),
		);
	}

	/**
	 * Default settings.
	 *
	 * @return array<string,mixed>
	 */
	public static function defaults() {
		return array(
			'key_hash'        => '',
			'key_prefix'      => '',
			'key_created'     => 0,
			'user_id'         => 0,
			'scopes'          => array( 'content', 'media' ),
			'read_only'       => false,
			'allow_http'      => false,
			'ip_allowlist'    => array(),
			'rate_limit'      => 120,
			'log_retention'   => 30,
			'allowed_options' => array(),
		);
	}

	/**
	 * Current settings merged with defaults.
	 *
	 * @return array<string,mixed>
	 */
	public static function get() {
		$stored = get_option( DIBA_BRIDGE_OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		$settings = wp_parse_args( $stored, self::defaults() );

		$settings['scopes']          = array_values( array_intersect( self::scope_slugs(), (array) $settings['scopes'] ) );
		$settings['ip_allowlist']    = array_values( array_filter( array_map( 'strval', (array) $settings['ip_allowlist'] ) ) );
		$settings['allowed_options'] = array_values( array_filter( array_map( 'strval', (array) $settings['allowed_options'] ) ) );
		$settings['user_id']         = absint( $settings['user_id'] );
		$settings['rate_limit']      = max( 10, min( 6000, absint( $settings['rate_limit'] ) ) );
		$settings['log_retention']   = max( 1, min( 365, absint( $settings['log_retention'] ) ) );
		$settings['read_only']       = ! empty( $settings['read_only'] );
		$settings['allow_http']      = ! empty( $settings['allow_http'] );

		return $settings;
	}

	/**
	 * Persist a partial settings update.
	 *
	 * @param array<string,mixed> $changes Keys to change.
	 * @return void
	 */
	public static function update( array $changes ) {
		$settings = array_merge( self::get(), array_intersect_key( $changes, self::defaults() ) );
		if ( false === get_option( DIBA_BRIDGE_OPTION, false ) ) {
			add_option( DIBA_BRIDGE_OPTION, $settings, '', false );
		} else {
			update_option( DIBA_BRIDGE_OPTION, $settings, false );
		}
	}

	/**
	 * Keyed hash of an API key.
	 *
	 * @param string $key Plain key.
	 * @return string
	 */
	public static function hash_key( $key ) {
		return hash_hmac( 'sha256', (string) $key, wp_salt( 'auth' ) );
	}

	/**
	 * Create a new key, store only its hash and return the plain key once.
	 *
	 * @return string
	 */
	public static function generate_key() {
		$key = 'dbk_' . wp_generate_password( 44, false, false );
		self::update(
			array(
				'key_hash'    => self::hash_key( $key ),
				'key_prefix'  => substr( $key, 0, 8 ),
				'key_created' => time(),
			)
		);
		return $key;
	}

	/**
	 * Remove the key; every request is refused until a new one is generated.
	 *
	 * @return void
	 */
	public static function revoke_key() {
		self::update(
			array(
				'key_hash'    => '',
				'key_prefix'  => '',
				'key_created' => 0,
			)
		);
	}

	/**
	 * Whether a key has been generated.
	 *
	 * @return bool
	 */
	public static function has_key() {
		$settings = self::get();
		return '' !== (string) $settings['key_hash'];
	}

	/**
	 * Constant-time key check.
	 *
	 * @param string $key Key sent by the client.
	 * @return bool
	 */
	public static function verify_key( $key ) {
		$settings = self::get();
		$stored   = (string) $settings['key_hash'];
		if ( '' === $stored || ! is_string( $key ) || '' === $key || strlen( $key ) > 200 ) {
			return false;
		}
		return hash_equals( $stored, self::hash_key( $key ) );
	}

	/**
	 * Whether a scope is enabled.
	 *
	 * @param string $scope Scope slug.
	 * @return bool
	 */
	public static function scope_enabled( $scope ) {
		$settings = self::get();
		return in_array( $scope, $settings['scopes'], true );
	}
}
