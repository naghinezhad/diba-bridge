<?php
/**
 * Maintenance tools: options, cache, search-replace, bulk edit, cron,
 * maintenance mode, statistics, site health and the activity log route.
 *
 * @package DibaBridgeConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Tools module. There is deliberately no endpoint that runs PHP or SQL
 * supplied by the client and none that reads or writes arbitrary files.
 */
class Diba_Bridge_Tools {

	/**
	 * Options that may be read by default.
	 *
	 * @var string[]
	 */
	private static $readable_options = array(
		'blogname',
		'blogdescription',
		'siteurl',
		'home',
		'admin_email',
		'WPLANG',
		'timezone_string',
		'gmt_offset',
		'date_format',
		'time_format',
		'start_of_week',
		'permalink_structure',
		'posts_per_page',
		'posts_per_rss',
		'show_on_front',
		'page_on_front',
		'page_for_posts',
		'default_category',
		'default_comment_status',
		'default_ping_status',
		'comment_moderation',
		'comment_registration',
		'close_comments_for_old_posts',
		'users_can_register',
		'default_role',
		'blog_public',
		'template',
		'stylesheet',
		'thumbnail_size_w',
		'thumbnail_size_h',
		'medium_size_w',
		'medium_size_h',
		'large_size_w',
		'large_size_h',
		'uploads_use_yearmonth_folders',
	);

	/**
	 * Allow-listed options that can never be written through the API.
	 *
	 * @var string[]
	 */
	private static $read_only_options = array( 'template', 'stylesheet', 'admin_email' );

	/**
	 * Options that need an explicit confirm flag.
	 *
	 * @var string[]
	 */
	private static $confirm_options = array( 'siteurl', 'home' );

	/**
	 * Options stored as non-negative integers.
	 *
	 * @var string[]
	 */
	private static $integer_options = array(
		'start_of_week',
		'posts_per_page',
		'posts_per_rss',
		'page_on_front',
		'page_for_posts',
		'default_category',
		'comment_moderation',
		'comment_registration',
		'close_comments_for_old_posts',
		'users_can_register',
		'blog_public',
		'thumbnail_size_w',
		'thumbnail_size_h',
		'medium_size_w',
		'medium_size_h',
		'large_size_w',
		'large_size_h',
		'uploads_use_yearmonth_folders',
	);

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public static function register_routes() {
		$ns = DIBA_BRIDGE_REST_NAMESPACE;

		register_rest_route(
			$ns,
			'/site-health',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'site_health' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'tools', 'view_site_health_checks' ),
			)
		);

		register_rest_route(
			$ns,
			'/options',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'get_options' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'options', 'manage_options' ),
					'args'                => array(
						'names' => array(
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'update_option' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'options', 'manage_options', true ),
					'args'                => array(
						'name'    => array(
							'type'     => 'string',
							'required' => true,
							'pattern'  => '^[A-Za-z0-9_\-:.]{1,190}$',
						),
						'value'   => array(
							'required' => true,
						),
						'confirm' => array(
							'type'    => 'boolean',
							'default' => false,
						),
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/cache/flush',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'flush_cache' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'tools', 'manage_options', true ),
				'args'                => array(
					'rewrite_rules' => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/search-replace',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'search_replace' ),
				'permission_callback' => array( __CLASS__, 'search_replace_permission' ),
				'args'                => array(
					'search'         => array(
						'type'      => 'string',
						'required'  => true,
						'minLength' => 2,
						'maxLength' => 500,
					),
					'replace'        => array(
						'type'      => 'string',
						'required'  => true,
						'maxLength' => 2000,
					),
					'dry_run'        => array(
						'type'    => 'boolean',
						'default' => true,
					),
					'post_types'     => array(
						'type'    => 'array',
						'items'   => array( 'type' => 'string' ),
						'default' => array( 'post', 'page' ),
					),
					'fields'         => array(
						'type'    => 'array',
						'items'   => array(
							'type' => 'string',
							'enum' => array( 'content', 'title', 'excerpt' ),
						),
						'default' => array( 'content' ),
					),
					'include_meta'   => array(
						'type'    => 'boolean',
						'default' => false,
					),
					'case_sensitive' => array(
						'type'    => 'boolean',
						'default' => true,
					),
					'limit'          => array(
						'type'    => 'integer',
						'default' => 100,
						'minimum' => 1,
						'maximum' => 500,
					),
					'offset'         => array(
						'type'    => 'integer',
						'default' => 0,
						'minimum' => 0,
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/posts/bulk',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'bulk_update' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'content', 'edit_posts', true ),
				'args'                => array(
					'ids'               => array(
						'type'     => 'array',
						'required' => true,
						'items'    => array( 'type' => 'integer' ),
						'minItems' => 1,
						'maxItems' => 100,
					),
					'status'            => array(
						'type' => 'string',
						'enum' => array( 'publish', 'draft', 'pending', 'private', 'trash' ),
					),
					'author'            => array(
						'type' => 'integer',
					),
					'comment_status'    => array(
						'type' => 'string',
						'enum' => array( 'open', 'closed' ),
					),
					'add_categories'    => array(
						'type'  => 'array',
						'items' => array( 'type' => 'integer' ),
					),
					'remove_categories' => array(
						'type'  => 'array',
						'items' => array( 'type' => 'integer' ),
					),
					'add_tags'          => array(
						'type'  => 'array',
						'items' => array( 'type' => 'integer' ),
					),
					'remove_tags'       => array(
						'type'  => 'array',
						'items' => array( 'type' => 'integer' ),
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/cron',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'list_cron' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'tools', 'manage_options' ),
			)
		);

		register_rest_route(
			$ns,
			'/cron/run',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'run_cron' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'tools', 'manage_options', true ),
				'args'                => array(
					'hook' => array(
						'type'     => 'string',
						'required' => true,
						'pattern'  => '^[A-Za-z0-9_\-./:]{1,190}$',
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/maintenance',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'get_maintenance' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'tools', 'manage_options' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'set_maintenance' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'tools', 'manage_options', true ),
					'args'                => array(
						'enabled' => array(
							'type'     => 'boolean',
							'required' => true,
						),
						'message' => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_textarea_field',
						),
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/stats',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'stats' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'content', 'edit_posts' ),
			)
		);

		register_rest_route(
			$ns,
			'/activity-log',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'activity_log' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'tools', 'manage_options' ),
				'args'                => array(
					'status'   => array(
						'type'    => 'string',
						'enum'    => array( 'all', 'ok', 'error' ),
						'default' => 'all',
					),
					'page'     => array(
						'type'    => 'integer',
						'default' => 1,
						'minimum' => 1,
					),
					'per_page' => array(
						'type'    => 'integer',
						'default' => 20,
						'minimum' => 1,
						'maximum' => 100,
					),
				),
			)
		);
	}

	// ------------------------------------------------------------------
	// Site health
	// ------------------------------------------------------------------

	/**
	 * GET /site-health.
	 *
	 * @return WP_REST_Response
	 */
	public static function site_health() {
		global $wpdb;

		$updates = function_exists( 'wp_get_update_data' ) ? wp_get_update_data() : array();
		$counts  = isset( $updates['counts'] ) && is_array( $updates['counts'] ) ? $updates['counts'] : array();
		$theme   = wp_get_theme();

		return rest_ensure_response(
			array(
				'wp_version'       => get_bloginfo( 'version' ),
				'php_version'      => PHP_VERSION,
				'database_version' => $wpdb->db_version(),
				'https'            => is_ssl(),
				'multisite'        => is_multisite(),
				'environment'      => function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'production',
				'memory_limit'     => defined( 'WP_MEMORY_LIMIT' ) ? WP_MEMORY_LIMIT : '',
				'php_memory_limit' => (string) ini_get( 'memory_limit' ),
				'max_upload_size'  => size_format( wp_max_upload_size() ),
				'max_execution'    => (int) ini_get( 'max_execution_time' ),
				'debug'            => array(
					'wp_debug'         => defined( 'WP_DEBUG' ) && WP_DEBUG,
					'wp_debug_display' => defined( 'WP_DEBUG_DISPLAY' ) && WP_DEBUG_DISPLAY,
					'wp_debug_log'     => defined( 'WP_DEBUG_LOG' ) && WP_DEBUG_LOG ? true : false,
				),
				'object_cache'     => (bool) wp_using_ext_object_cache(),
				'cron_disabled'    => defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
				'updates'          => array(
					'plugins'   => isset( $counts['plugins'] ) ? (int) $counts['plugins'] : 0,
					'themes'    => isset( $counts['themes'] ) ? (int) $counts['themes'] : 0,
					'wordpress' => isset( $counts['wordpress'] ) ? (int) $counts['wordpress'] : 0,
					'total'     => isset( $counts['total'] ) ? (int) $counts['total'] : 0,
				),
				'theme'            => array(
					'name'    => $theme->get( 'Name' ),
					'version' => $theme->get( 'Version' ),
				),
				'permalinks'       => '' !== (string) get_option( 'permalink_structure' ) ? 'pretty' : 'plain',
				'search_engines'   => '0' === (string) get_option( 'blog_public' ) ? 'discouraged' : 'allowed',
				'timezone'         => wp_timezone_string(),
				'maintenance_mode' => self::maintenance_enabled(),
			)
		);
	}

	// ------------------------------------------------------------------
	// Options
	// ------------------------------------------------------------------

	/**
	 * Hard deny-list. It always wins, even over the administrator's extra allow-list.
	 *
	 * @param string $name Option name.
	 * @return bool
	 */
	public static function option_denied( $name ) {
		global $wpdb;
		$name = strtolower( (string) $name );

		$exact = array(
			'active_plugins',
			'active_sitewide_plugins',
			'recently_activated',
			'cron',
			'rewrite_rules',
			'db_version',
			'initial_db_version',
			'auth_key',
			'secure_auth_key',
			'logged_in_key',
			'nonce_key',
			'auth_salt',
			'secure_auth_salt',
			'logged_in_salt',
			'nonce_salt',
			'mailserver_login',
			'mailserver_pass',
			'upload_path',
			'upload_url_path',
			strtolower( $wpdb->prefix ) . 'user_roles',
		);
		if ( in_array( $name, $exact, true ) ) {
			return true;
		}

		return (bool) preg_match( '/(^_transient|^_site_transient|^diba_bridge|user_roles$|_salt$|_key$|secret|password|passwd|_pass$|token|api_?key|licen[cs]e|private|credential)/', $name );
	}

	/**
	 * Names that may be read.
	 *
	 * @return string[]
	 */
	private static function allowed_option_names() {
		$settings = Diba_Bridge_Settings::get();
		return array_values( array_unique( array_merge( self::$readable_options, $settings['allowed_options'] ) ) );
	}

	/**
	 * GET /options?names=a,b.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function get_options( $request ) {
		$names = $request->get_param( 'names' );
		if ( ! is_array( $names ) ) {
			$names = explode( ',', (string) $names );
		}
		$names   = array_slice( array_filter( array_map( 'trim', array_map( 'strval', $names ) ) ), 0, 50 );
		$allowed = self::allowed_option_names();
		$values  = array();
		$denied  = array();

		foreach ( $names as $name ) {
			if ( ! preg_match( '/^[A-Za-z0-9_\-:.]{1,190}$/', $name ) || self::option_denied( $name ) || ! in_array( $name, $allowed, true ) ) {
				$denied[] = sanitize_text_field( $name );
				continue;
			}
			$values[ $name ] = get_option( $name, null );
		}

		return rest_ensure_response(
			array(
				'options' => (object) $values,
				'denied'  => $denied,
				'note'    => empty( $denied ) ? '' : __( 'گزینه‌های ردشده در فهرست مجاز افزونه نیستند یا جزو گزینه‌های حساس‌اند.', 'diba-bridge-connector' ),
			)
		);
	}

	/**
	 * POST /options.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function update_option( $request ) {
		$name    = (string) $request->get_param( 'name' );
		$value   = $request->get_param( 'value' );
		$confirm = (bool) $request->get_param( 'confirm' );

		if ( self::option_denied( $name ) || ! in_array( $name, self::allowed_option_names(), true ) || in_array( $name, self::$read_only_options, true ) ) {
			return new WP_Error( 'diba_bridge_option_denied', __( 'تغییر این گزینه از طریق افزونه‌ی Diba Bridge مجاز نیست.', 'diba-bridge-connector' ), array( 'status' => 403 ) );
		}
		if ( ! is_scalar( $value ) ) {
			return new WP_Error( 'diba_bridge_option_value', __( 'فقط مقدار ساده (متن، عدد یا بله/خیر) پذیرفته می‌شود.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}
		if ( in_array( $name, self::$confirm_options, true ) && ! $confirm ) {
			return new WP_Error( 'diba_bridge_confirm_required', __( 'تغییر نشانی سایت می‌تواند دسترسی به سایت را قطع کند؛ برای ادامه confirm=true بفرستید.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		if ( in_array( $name, self::$integer_options, true ) ) {
			$value = absint( $value );
		} elseif ( in_array( $name, self::$confirm_options, true ) ) {
			$value = esc_url_raw( trim( (string) $value ), array( 'http', 'https' ) );
			$host  = '' !== $value ? wp_parse_url( $value, PHP_URL_HOST ) : '';
			if ( '' === $value || empty( $host ) ) {
				return new WP_Error( 'diba_bridge_option_value', __( 'نشانی واردشده معتبر نیست.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
			}
			$value = untrailingslashit( $value );
		} elseif ( 'default_role' === $name ) {
			$value = sanitize_key( (string) $value );
			$role  = get_role( $value );
			if ( ! $role || $role->has_cap( 'manage_options' ) || $role->has_cap( 'edit_users' ) ) {
				return new WP_Error( 'diba_bridge_option_value', __( 'این نقش را نمی‌توان نقش پیش‌فرض کاربران جدید کرد.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
			}
		} elseif ( is_bool( $value ) ) {
			$value = $value ? '1' : '0';
		} else {
			$value = sanitize_text_field( (string) $value );
		}

		$previous = get_option( $name, null );

		if ( 'permalink_structure' === $name ) {
			global $wp_rewrite;
			$wp_rewrite->set_permalink_structure( $value );
			flush_rewrite_rules( false );
		} else {
			update_option( $name, $value );
		}

		return rest_ensure_response(
			array(
				'ok'       => true,
				'name'     => $name,
				'previous' => is_scalar( $previous ) || null === $previous ? $previous : null,
				'value'    => get_option( $name, null ),
			)
		);
	}

	// ------------------------------------------------------------------
	// Cache
	// ------------------------------------------------------------------

	/**
	 * POST /cache/flush.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function flush_cache( $request ) {
		$flushed = array();

		if ( wp_cache_flush() ) {
			$flushed[] = 'object-cache';
		}
		if ( function_exists( 'delete_expired_transients' ) ) {
			delete_expired_transients( true );
			$flushed[] = 'expired-transients';
		}

		if ( function_exists( 'rocket_clean_domain' ) ) {
			rocket_clean_domain();
			$flushed[] = 'wp-rocket';
		}
		if ( function_exists( 'w3tc_flush_all' ) ) {
			w3tc_flush_all();
			$flushed[] = 'w3-total-cache';
		}
		if ( function_exists( 'wp_cache_clear_cache' ) ) {
			wp_cache_clear_cache();
			$flushed[] = 'wp-super-cache';
		}
		if ( function_exists( 'wpfc_clear_all_cache' ) ) {
			wpfc_clear_all_cache( true );
			$flushed[] = 'wp-fastest-cache';
		}
		if ( defined( 'LSCWP_V' ) || class_exists( 'LiteSpeed_Cache' ) ) {
			do_action( 'litespeed_purge_all' );
			$flushed[] = 'litespeed-cache';
		}
		if ( class_exists( 'autoptimizeCache' ) && is_callable( array( 'autoptimizeCache', 'clearall' ) ) ) {
			autoptimizeCache::clearall();
			$flushed[] = 'autoptimize';
		}
		if ( function_exists( 'sg_cachepress_purge_cache' ) ) {
			sg_cachepress_purge_cache();
			$flushed[] = 'sg-optimizer';
		}
		if ( class_exists( 'Cache_Enabler' ) ) {
			do_action( 'cache_enabler_clear_complete_cache' );
			$flushed[] = 'cache-enabler';
		}
		if ( class_exists( 'WpeCommon' ) && is_callable( array( 'WpeCommon', 'purge_varnish_cache' ) ) ) {
			WpeCommon::purge_varnish_cache();
			$flushed[] = 'wp-engine';
		}

		if ( $request->get_param( 'rewrite_rules' ) ) {
			flush_rewrite_rules( false );
			$flushed[] = 'rewrite-rules';
		}

		return rest_ensure_response(
			array(
				'ok'      => true,
				'flushed' => $flushed,
			)
		);
	}

	// ------------------------------------------------------------------
	// Search and replace
	// ------------------------------------------------------------------

	/**
	 * Permission for /search-replace: a dry run only reads.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public static function search_replace_permission( $request ) {
		$dry_run = false !== $request->get_param( 'dry_run' ) && 'false' !== $request->get_param( 'dry_run' );
		return Diba_Bridge_Auth::authorize( $request, 'tools', 'edit_others_posts', ! $dry_run );
	}

	/**
	 * Replace inside a string and count the replacements.
	 *
	 * @param string $subject        Text.
	 * @param string $search         Needle.
	 * @param string $replace        Replacement.
	 * @param bool   $case_sensitive Case sensitivity.
	 * @param int    $count          Running total (by reference).
	 * @return string
	 */
	private static function replace_string( $subject, $search, $replace, $case_sensitive, &$count ) {
		$n      = 0;
		$result = $case_sensitive ? str_replace( $search, $replace, $subject, $n ) : str_ireplace( $search, $replace, $subject, $n );
		$count += $n;
		return $result;
	}

	/**
	 * Recursively replace inside arrays. Objects are never touched.
	 *
	 * @param mixed  $data           Value.
	 * @param string $search         Needle.
	 * @param string $replace        Replacement.
	 * @param bool   $case_sensitive Case sensitivity.
	 * @param int    $count          Running total (by reference).
	 * @return mixed
	 */
	private static function replace_deep( $data, $search, $replace, $case_sensitive, &$count ) {
		if ( is_string( $data ) ) {
			return self::replace_string( $data, $search, $replace, $case_sensitive, $count );
		}
		if ( is_array( $data ) ) {
			foreach ( $data as $key => $value ) {
				$data[ $key ] = self::replace_deep( $value, $search, $replace, $case_sensitive, $count );
			}
		}
		return $data;
	}

	/**
	 * Whether a value contains an object anywhere.
	 *
	 * @param mixed $data Value.
	 * @return bool
	 */
	private static function contains_object( $data ) {
		if ( is_object( $data ) ) {
			return true;
		}
		if ( is_array( $data ) ) {
			foreach ( $data as $value ) {
				if ( self::contains_object( $value ) ) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * POST /search-replace. Dry run by default.
	 *
	 * Post fields are saved with wp_update_post() (revisions and KSES apply).
	 * Serialized custom fields are unserialized with classes disabled, changed
	 * as arrays and re-serialized by WordPress, so string lengths stay valid.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function search_replace( $request ) {
		global $wpdb;

		$search         = (string) $request->get_param( 'search' );
		$replace        = (string) $request->get_param( 'replace' );
		$dry_run        = (bool) $request->get_param( 'dry_run' );
		$include_meta   = (bool) $request->get_param( 'include_meta' );
		$case_sensitive = (bool) $request->get_param( 'case_sensitive' );
		$limit          = max( 1, min( 500, absint( $request->get_param( 'limit' ) ) ) );
		$offset         = absint( $request->get_param( 'offset' ) );

		if ( '' === trim( $search ) || strlen( $search ) < 2 ) {
			return new WP_Error( 'diba_bridge_search_too_short', __( 'عبارت جستجو باید حداقل ۲ نویسه باشد.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}
		if ( $search === $replace ) {
			return new WP_Error( 'diba_bridge_same_value', __( 'عبارت جستجو و جایگزین یکسان است.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		// Only existing post types the acting user may edit for everyone.
		$types = array();
		foreach ( (array) $request->get_param( 'post_types' ) as $type ) {
			$type   = sanitize_key( (string) $type );
			$object = $type ? get_post_type_object( $type ) : null;
			if ( $object && current_user_can( $object->cap->edit_others_posts ) ) {
				$types[] = $type;
			}
		}
		$types = array_values( array_unique( $types ) );
		if ( empty( $types ) ) {
			return new WP_Error( 'diba_bridge_no_post_types', __( 'هیچ نوع محتوای معتبری که اجازه‌ی ویرایش آن را داشته باشید انتخاب نشده است.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		// Column names come from this fixed map, never from the request.
		$column_map = array(
			'content' => 'post_content',
			'title'   => 'post_title',
			'excerpt' => 'post_excerpt',
		);
		$columns    = array();
		foreach ( (array) $request->get_param( 'fields' ) as $field ) {
			if ( isset( $column_map[ $field ] ) ) {
				$columns[ $field ] = $column_map[ $field ];
			}
		}
		if ( empty( $columns ) ) {
			$columns = array( 'content' => 'post_content' );
		}

		$like              = '%' . $wpdb->esc_like( $search ) . '%';
		$type_placeholders = implode( ', ', array_fill( 0, count( $types ), '%s' ) );
		$conditions        = array();
		foreach ( $columns as $column ) {
			$conditions[] = "{$column} LIKE %s";
		}
		$where_columns = implode( ' OR ', $conditions );

		$params = array_merge( $types, array_fill( 0, count( $columns ), $like ), array( $limit, $offset ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders, WordPress.DB.DirectDatabaseQuery
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts} WHERE post_type IN ({$type_placeholders}) AND post_status NOT IN ('auto-draft', 'inherit', 'trash') AND ({$where_columns}) ORDER BY ID ASC LIMIT %d OFFSET %d",
				$params
			)
		);
		// phpcs:enable

		$posts_changed = 0;
		$replacements  = 0;
		$skipped       = 0;
		$samples       = array();

		foreach ( (array) $ids as $post_id ) {
			$post_id = (int) $post_id;
			$post    = get_post( $post_id );
			if ( ! $post || ! current_user_can( 'edit_post', $post_id ) ) {
				++$skipped;
				continue;
			}

			$update = array();
			$found  = 0;
			foreach ( $columns as $column ) {
				$n   = 0;
				$new = self::replace_string( (string) $post->$column, $search, $replace, $case_sensitive, $n );
				if ( $n > 0 ) {
					$update[ $column ] = $new;
					$found            += $n;
				}
			}
			if ( 0 === $found ) {
				continue;
			}

			if ( ! $dry_run ) {
				$update['ID'] = $post_id;
				$result       = wp_update_post( wp_slash( $update ), true );
				if ( is_wp_error( $result ) ) {
					++$skipped;
					continue;
				}
			}

			++$posts_changed;
			$replacements += $found;
			if ( count( $samples ) < 20 ) {
				$samples[] = array(
					'id'           => $post_id,
					'type'         => $post->post_type,
					'title'        => wp_strip_all_tags( get_the_title( $post ) ),
					'replacements' => $found,
				);
			}
		}

		$meta_changed      = 0;
		$meta_replacements = 0;

		if ( $include_meta ) {
			$meta_params = array_merge( $types, array( $wpdb->esc_like( '_' ) . '%', $like, $limit ) );

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders, WordPress.DB.DirectDatabaseQuery
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT pm.meta_id, pm.post_id, pm.meta_key, pm.meta_value FROM {$wpdb->postmeta} pm INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id WHERE p.post_type IN ({$type_placeholders}) AND p.post_status NOT IN ('auto-draft', 'inherit', 'trash') AND pm.meta_key NOT LIKE %s AND pm.meta_value LIKE %s ORDER BY pm.meta_id ASC LIMIT %d",
					$meta_params
				)
			);
			// phpcs:enable

			foreach ( (array) $rows as $row ) {
				$post_id = (int) $row->post_id;
				if ( is_protected_meta( $row->meta_key, 'post' ) || ! current_user_can( 'edit_post', $post_id ) ) {
					++$skipped;
					continue;
				}

				$n     = 0;
				$value = (string) $row->meta_value;

				if ( is_serialized( $value ) ) {
					// Classes are never instantiated; rows holding objects are left alone.
					$data = @unserialize( trim( $value ), array( 'allowed_classes' => false ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors, WordPress.PHP.DiscouragedPHPFunctions
					if ( false === $data || self::contains_object( $data ) ) {
						++$skipped;
						continue;
					}
					$new = self::replace_deep( $data, $search, $replace, $case_sensitive, $n );
				} else {
					$new = self::replace_string( $value, $search, $replace, $case_sensitive, $n );
				}

				if ( 0 === $n ) {
					continue;
				}
				if ( ! $dry_run ) {
					update_metadata_by_mid( 'post', (int) $row->meta_id, $new );
				}
				++$meta_changed;
				$meta_replacements += $n;
			}
		}

		$matched = count( (array) $ids );

		return rest_ensure_response(
			array(
				'ok'                => true,
				'dry_run'           => $dry_run,
				'search'            => $search,
				'replace'           => $replace,
				'post_types'        => $types,
				'fields'            => array_keys( $columns ),
				'posts_scanned'     => $matched,
				'posts_changed'     => $posts_changed,
				'replacements'      => $replacements,
				'meta_changed'      => $meta_changed,
				'meta_replacements' => $meta_replacements,
				'skipped'           => $skipped,
				'has_more'          => $matched >= $limit,
				'next_offset'       => $dry_run ? $offset + $matched : 0,
				'samples'           => $samples,
				'note'              => $dry_run
					? __( 'این فقط پیش‌نمایش بود؛ برای اعمال تغییرات dry_run=false بفرستید.', 'diba-bridge-connector' )
					: __( 'تغییرات اعمال شد؛ نسخه‌ی قبلی هر نوشته در بازبینی‌ها موجود است.', 'diba-bridge-connector' ),
			)
		);
	}

	// ------------------------------------------------------------------
	// Bulk update
	// ------------------------------------------------------------------

	/**
	 * POST /posts/bulk.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function bulk_update( $request ) {
		$ids            = array_slice( array_values( array_unique( array_filter( array_map( 'absint', (array) $request->get_param( 'ids' ) ) ) ) ), 0, 100 );
		$status         = $request->get_param( 'status' );
		$author         = absint( $request->get_param( 'author' ) );
		$comment_status = $request->get_param( 'comment_status' );
		$term_changes   = array(
			'category' => array(
				'add'    => array_filter( array_map( 'absint', (array) $request->get_param( 'add_categories' ) ) ),
				'remove' => array_filter( array_map( 'absint', (array) $request->get_param( 'remove_categories' ) ) ),
			),
			'post_tag' => array(
				'add'    => array_filter( array_map( 'absint', (array) $request->get_param( 'add_tags' ) ) ),
				'remove' => array_filter( array_map( 'absint', (array) $request->get_param( 'remove_tags' ) ) ),
			),
		);

		if ( $author && ! get_userdata( $author ) ) {
			return new WP_Error( 'diba_bridge_invalid_author', __( 'نویسنده‌ای با این شناسه پیدا نشد.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		$updated = array();
		$failed  = array();

		foreach ( $ids as $post_id ) {
			$post = get_post( $post_id );
			if ( ! $post || in_array( $post->post_type, array( 'revision', 'nav_menu_item', 'attachment' ), true ) ) {
				$failed[] = array(
					'id'     => $post_id,
					'reason' => 'not_found',
				);
				continue;
			}
			$type = get_post_type_object( $post->post_type );
			if ( ! $type || ! current_user_can( 'edit_post', $post_id ) ) {
				$failed[] = array(
					'id'     => $post_id,
					'reason' => 'forbidden',
				);
				continue;
			}

			if ( 'trash' === $status ) {
				if ( ! current_user_can( 'delete_post', $post_id ) || ! wp_trash_post( $post_id ) ) {
					$failed[] = array(
						'id'     => $post_id,
						'reason' => 'cannot_trash',
					);
					continue;
				}
				$updated[] = $post_id;
				continue;
			}

			$update = array();
			if ( is_string( $status ) && '' !== $status ) {
				if ( in_array( $status, array( 'publish', 'private' ), true ) && ! current_user_can( $type->cap->publish_posts ) ) {
					$failed[] = array(
						'id'     => $post_id,
						'reason' => 'cannot_publish',
					);
					continue;
				}
				$update['post_status'] = $status;
			}
			if ( $author ) {
				if ( ! current_user_can( $type->cap->edit_others_posts ) ) {
					$failed[] = array(
						'id'     => $post_id,
						'reason' => 'cannot_change_author',
					);
					continue;
				}
				$update['post_author'] = $author;
			}
			if ( is_string( $comment_status ) && '' !== $comment_status ) {
				$update['comment_status'] = $comment_status;
			}

			if ( ! empty( $update ) ) {
				$update['ID'] = $post_id;
				$result       = wp_update_post( wp_slash( $update ), true );
				if ( is_wp_error( $result ) ) {
					$failed[] = array(
						'id'     => $post_id,
						'reason' => $result->get_error_code(),
					);
					continue;
				}
			}

			foreach ( $term_changes as $taxonomy => $change ) {
				if ( ! is_object_in_taxonomy( $post->post_type, $taxonomy ) ) {
					continue;
				}
				$tax = get_taxonomy( $taxonomy );
				if ( ! $tax || ! current_user_can( $tax->cap->assign_terms ) ) {
					continue;
				}
				if ( ! empty( $change['add'] ) ) {
					wp_set_object_terms( $post_id, array_values( $change['add'] ), $taxonomy, true );
				}
				if ( ! empty( $change['remove'] ) ) {
					wp_remove_object_terms( $post_id, array_values( $change['remove'] ), $taxonomy );
				}
			}

			$updated[] = $post_id;
		}

		return rest_ensure_response(
			array(
				'ok'            => empty( $failed ),
				'updated_count' => count( $updated ),
				'updated'       => $updated,
				'failed'        => $failed,
			)
		);
	}

	// ------------------------------------------------------------------
	// Cron
	// ------------------------------------------------------------------

	/**
	 * GET /cron.
	 *
	 * @return WP_REST_Response
	 */
	public static function list_cron() {
		$events = array();
		$crons  = _get_cron_array();
		foreach ( (array) $crons as $timestamp => $hooks ) {
			foreach ( (array) $hooks as $hook => $instances ) {
				foreach ( (array) $instances as $instance ) {
					$events[] = array(
						'hook'       => (string) $hook,
						'next_run'   => gmdate( 'Y-m-d\TH:i:s\Z', (int) $timestamp ),
						'overdue'    => (int) $timestamp < time(),
						'schedule'   => ! empty( $instance['schedule'] ) ? (string) $instance['schedule'] : 'once',
						'interval'   => isset( $instance['interval'] ) ? (int) $instance['interval'] : 0,
						'args_count' => isset( $instance['args'] ) ? count( (array) $instance['args'] ) : 0,
					);
				}
			}
		}

		return rest_ensure_response(
			array(
				'count'         => count( $events ),
				'cron_disabled' => defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
				'items'         => array_slice( $events, 0, 300 ),
			)
		);
	}

	/**
	 * POST /cron/run — only hooks that are currently scheduled can be run,
	 * so this cannot be used to fire arbitrary actions.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function run_cron( $request ) {
		$hook  = (string) $request->get_param( 'hook' );
		$crons = _get_cron_array();

		foreach ( (array) $crons as $hooks ) {
			if ( ! isset( $hooks[ $hook ] ) || ! is_array( $hooks[ $hook ] ) ) {
				continue;
			}
			$instance = reset( $hooks[ $hook ] );
			$args     = isset( $instance['args'] ) ? (array) $instance['args'] : array();
			$started  = microtime( true );

			do_action_ref_array( $hook, $args );

			return rest_ensure_response(
				array(
					'ok'          => true,
					'hook'        => $hook,
					'duration_ms' => (int) round( ( microtime( true ) - $started ) * 1000 ),
				)
			);
		}

		return new WP_Error( 'diba_bridge_cron_not_found', __( 'کار زمان‌بندی‌شده‌ای با این نام وجود ندارد.', 'diba-bridge-connector' ), array( 'status' => 404 ) );
	}

	// ------------------------------------------------------------------
	// Maintenance mode
	// ------------------------------------------------------------------

	/**
	 * Stored maintenance state.
	 *
	 * @return array{enabled:bool,message:string}
	 */
	public static function maintenance_state() {
		$state = get_option( DIBA_BRIDGE_MAINTENANCE_OPTION, array() );
		if ( ! is_array( $state ) ) {
			$state = array();
		}
		return array(
			'enabled' => ! empty( $state['enabled'] ),
			'message' => isset( $state['message'] ) ? (string) $state['message'] : '',
		);
	}

	/**
	 * Whether maintenance mode is on.
	 *
	 * @return bool
	 */
	public static function maintenance_enabled() {
		$state = self::maintenance_state();
		return $state['enabled'];
	}

	/**
	 * Hook the front-end gate.
	 *
	 * @return void
	 */
	public static function init_maintenance() {
		add_action( 'template_redirect', array( __CLASS__, 'maintenance_gate' ), 0 );
	}

	/**
	 * Show a 503 page to visitors while maintenance mode is on.
	 * Administrators, the dashboard, the login page and the REST API are not affected.
	 *
	 * @return void
	 */
	public static function maintenance_gate() {
		$state = self::maintenance_state();
		if ( ! $state['enabled'] || current_user_can( 'manage_options' ) ) {
			return;
		}

		$message = '' !== $state['message']
			? $state['message']
			: __( 'سایت در حال به‌روزرسانی است. لطفاً کمی بعد دوباره سر بزنید.', 'diba-bridge-connector' );

		nocache_headers();
		header( 'Retry-After: 1800' );
		wp_die(
			esc_html( $message ),
			esc_html__( 'در حال به‌روزرسانی', 'diba-bridge-connector' ),
			array( 'response' => 503 )
		);
	}

	/**
	 * GET /maintenance.
	 *
	 * @return WP_REST_Response
	 */
	public static function get_maintenance() {
		return rest_ensure_response( self::maintenance_state() );
	}

	/**
	 * POST /maintenance.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function set_maintenance( $request ) {
		$state            = self::maintenance_state();
		$state['enabled'] = (bool) $request->get_param( 'enabled' );
		if ( null !== $request->get_param( 'message' ) ) {
			$state['message'] = substr( sanitize_textarea_field( (string) $request->get_param( 'message' ) ), 0, 1000 );
		}
		update_option( DIBA_BRIDGE_MAINTENANCE_OPTION, $state, true );

		return rest_ensure_response( array_merge( array( 'ok' => true ), self::maintenance_state() ) );
	}

	// ------------------------------------------------------------------
	// Statistics
	// ------------------------------------------------------------------

	/**
	 * GET /stats.
	 *
	 * @return WP_REST_Response
	 */
	public static function stats() {
		$post_types = array();
		foreach ( get_post_types( array( 'show_ui' => true ), 'objects' ) as $type ) {
			if ( in_array( $type->name, array( 'attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles', 'wp_font_family', 'wp_font_face' ), true ) ) {
				continue;
			}
			if ( ! current_user_can( $type->cap->edit_posts ) ) {
				continue;
			}
			$counts = (array) wp_count_posts( $type->name );
			$row    = array( 'label' => $type->labels->name );
			$total  = 0;
			foreach ( array( 'publish', 'future', 'draft', 'pending', 'private', 'trash' ) as $status ) {
				$row[ $status ] = isset( $counts[ $status ] ) ? (int) $counts[ $status ] : 0;
				if ( 'trash' !== $status ) {
					$total += $row[ $status ];
				}
			}
			$row['total']              = $total;
			$post_types[ $type->name ] = $row;
		}

		$comments = wp_count_comments();
		$media    = array_sum( (array) wp_count_attachments() );

		$stats = array(
			'post_types' => $post_types,
			'comments'   => array(
				'approved' => (int) $comments->approved,
				'pending'  => (int) $comments->moderated,
				'spam'     => (int) $comments->spam,
				'trash'    => (int) $comments->trash,
				'total'    => (int) $comments->total_comments,
			),
			'media'      => (int) $media,
			'terms'      => array(
				'categories' => (int) wp_count_terms( array( 'taxonomy' => 'category' ) ),
				'tags'       => (int) wp_count_terms( array( 'taxonomy' => 'post_tag' ) ),
			),
		);

		if ( current_user_can( 'list_users' ) ) {
			$users          = count_users();
			$stats['users'] = array(
				'total'   => (int) $users['total_users'],
				'by_role' => array_filter( array_map( 'intval', (array) $users['avail_roles'] ) ),
			);
		}

		return rest_ensure_response( $stats );
	}

	// ------------------------------------------------------------------
	// Activity log
	// ------------------------------------------------------------------

	/**
	 * GET /activity-log.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function activity_log( $request ) {
		$per_page = max( 1, min( 100, absint( $request->get_param( 'per_page' ) ) ) );
		$page     = max( 1, absint( $request->get_param( 'page' ) ) );
		$result   = Diba_Bridge_Audit_Log::query(
			array(
				'page'     => $page,
				'per_page' => $per_page,
				'status'   => (string) $request->get_param( 'status' ),
			)
		);

		return rest_ensure_response(
			array(
				'total'       => $result['total'],
				'total_pages' => (int) ceil( $result['total'] / $per_page ),
				'page'        => $page,
				'per_page'    => $per_page,
				'count'       => count( $result['items'] ),
				'items'       => $result['items'],
			)
		);
	}
}
