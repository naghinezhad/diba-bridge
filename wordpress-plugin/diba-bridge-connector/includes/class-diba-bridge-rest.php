<?php
/**
 * Core REST routes: ping, site info, core REST proxy, media upload, themes, menus.
 *
 * @package DibaBridgeConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Main REST controller.
 */
class Diba_Bridge_REST {

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public static function register_routes() {
		$ns = DIBA_BRIDGE_REST_NAMESPACE;

		register_rest_route(
			$ns,
			'/ping',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'ping' ),
				'permission_callback' => Diba_Bridge_Auth::permission( null, 'read' ),
			)
		);

		register_rest_route(
			$ns,
			'/site-info',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'site_info' ),
				'permission_callback' => Diba_Bridge_Auth::permission( null, 'read' ),
			)
		);

		register_rest_route(
			$ns,
			'/proxy',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'proxy' ),
				'permission_callback' => array( __CLASS__, 'proxy_permission' ),
				'args'                => array(
					'method' => array(
						'type'    => 'string',
						'enum'    => array( 'GET', 'POST', 'PUT', 'PATCH', 'DELETE' ),
						'default' => 'GET',
					),
					'path'   => array(
						'type'              => 'string',
						'required'          => true,
						'validate_callback' => array( __CLASS__, 'validate_proxy_path' ),
					),
					// query and body are forwarded to the inner core route, which
					// validates and sanitizes them against its own schema.
					'query'  => array(
						'default' => array(),
					),
					'body'   => array(
						'default' => null,
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/media',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'upload_media' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'media', 'upload_files', true ),
				'args'                => array(
					'title'    => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'alt_text' => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'caption'  => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_textarea_field',
					),
					'post'     => array(
						'type'              => 'integer',
						'sanitize_callback' => 'absint',
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/themes/activate',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'activate_theme' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'plugins', 'switch_themes', true ),
				'args'                => array(
					'stylesheet' => array(
						'type'     => 'string',
						'required' => true,
						'pattern'  => '^[A-Za-z0-9._-]+$',
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/menus',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'list_menus' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'content', 'edit_theme_options' ),
			)
		);

		register_rest_route(
			$ns,
			'/menus/(?P<id>\d+)/items',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'menu_items' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'content', 'edit_theme_options' ),
				'args'                => array(
					'id' => array(
						'type'              => 'integer',
						'sanitize_callback' => 'absint',
					),
				),
			)
		);
	}

	/**
	 * Compact description of the acting user.
	 *
	 * @return array<string,mixed>
	 */
	public static function current_user_summary() {
		$user = wp_get_current_user();
		return array(
			'id'       => (int) $user->ID,
			'username' => (string) $user->user_login,
			'name'     => (string) $user->display_name,
			'roles'    => array_values( (array) $user->roles ),
		);
	}

	/**
	 * GET /ping — authenticated connection test.
	 *
	 * @return WP_REST_Response
	 */
	public static function ping() {
		$settings = Diba_Bridge_Settings::get();
		return rest_ensure_response(
			array(
				'ok'                => true,
				'site_name'         => wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES ),
				'site_url'          => home_url(),
				'wp_version'        => get_bloginfo( 'version' ),
				'connector_version' => DIBA_BRIDGE_VERSION,
				'user'              => self::current_user_summary(),
				'read_only'         => (bool) $settings['read_only'],
				'scopes'            => $settings['scopes'],
			)
		);
	}

	/**
	 * Which supported SEO plugin is active.
	 *
	 * @return string|null
	 */
	public static function seo_plugin() {
		if ( defined( 'WPSEO_VERSION' ) ) {
			return 'yoast';
		}
		if ( class_exists( 'RankMath' ) ) {
			return 'rank-math';
		}
		return null;
	}

	/**
	 * GET /site-info.
	 *
	 * @return WP_REST_Response
	 */
	public static function site_info() {
		$settings = Diba_Bridge_Settings::get();
		$theme    = wp_get_theme();
		$active   = (array) get_option( 'active_plugins', array() );
		if ( is_multisite() ) {
			$active = array_merge( $active, array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) ) );
		}

		$info = array(
			'name'                 => wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES ),
			'description'          => wp_specialchars_decode( get_bloginfo( 'description' ), ENT_QUOTES ),
			'url'                  => site_url(),
			'home'                 => home_url(),
			'wp_version'           => get_bloginfo( 'version' ),
			'language'             => get_locale(),
			'timezone'             => wp_timezone_string(),
			'multisite'            => is_multisite(),
			'permalink_structure'  => (string) get_option( 'permalink_structure' ),
			'theme'                => array(
				'name'       => $theme->get( 'Name' ),
				'stylesheet' => $theme->get_stylesheet(),
				'template'   => $theme->get_template(),
				'version'    => $theme->get( 'Version' ),
			),
			'active_plugins_count' => count( array_unique( $active ) ),
			'woocommerce'          => array(
				'active'  => Diba_Bridge_WooCommerce::is_available(),
				'version' => defined( 'WC_VERSION' ) ? WC_VERSION : null,
			),
			'seo_plugin'           => self::seo_plugin(),
			'maintenance_mode'     => Diba_Bridge_Tools::maintenance_enabled(),
			'connector'            => array(
				'installed'  => true,
				'configured' => true,
				'version'    => DIBA_BRIDGE_VERSION,
				'read_only'  => (bool) $settings['read_only'],
				'scopes'     => $settings['scopes'],
				'user'       => self::current_user_summary(),
			),
		);

		if ( current_user_can( 'manage_options' ) ) {
			$info['php_version'] = PHP_VERSION;
		}

		return rest_ensure_response( $info );
	}

	/**
	 * Validate the inner path of a proxied request.
	 *
	 * @param mixed $path Path under /wp-json.
	 * @return true|WP_Error
	 */
	public static function validate_proxy_path( $path ) {
		$invalid = new WP_Error( 'diba_bridge_invalid_path', __( 'مسیر درخواست نامعتبر است.', 'diba-bridge-connector' ), array( 'status' => 400 ) );

		if ( ! is_string( $path ) || '' === $path || strlen( $path ) > 500 ) {
			return $invalid;
		}
		if ( ! preg_match( '#^/[A-Za-z0-9_\-./~@:+,()=]*$#', $path ) || false !== strpos( $path, '//' ) ) {
			return $invalid;
		}
		foreach ( explode( '/', $path ) as $segment ) {
			if ( '..' === $segment || '.' === $segment ) {
				return $invalid;
			}
		}
		// No recursion into this plugin and no minting of long-lived credentials through the key.
		if ( Diba_Bridge_Auth::is_own_route( $path ) || false !== stripos( $path, 'application-passwords' ) ) {
			return new WP_Error( 'diba_bridge_path_blocked', __( 'این مسیر از طریق افزونه‌ی Diba Bridge در دسترس نیست.', 'diba-bridge-connector' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * Scope that covers a core REST path.
	 *
	 * @param string $path Inner path.
	 * @return string
	 */
	public static function proxy_scope( $path ) {
		$path = strtolower( $path );
		$map  = array(
			'/wp/v2/users'            => 'users',
			'/wp/v2/plugins'          => 'plugins',
			'/wp/v2/themes'           => 'plugins',
			'/wp/v2/settings'         => 'options',
			'/wp/v2/media'            => 'media',
			'/wc/'                    => 'woocommerce',
			'/wc-'                    => 'woocommerce',
			'/wp-site-health/'        => 'tools',
			'/wp/v2/global-styles'    => 'plugins',
			'/wp/v2/templates'        => 'plugins',
			'/wp/v2/template-parts'   => 'plugins',
			'/wp/v2/font-families'    => 'plugins',
			'/wp/v2/widgets'          => 'plugins',
			'/wp/v2/sidebars'         => 'plugins',
			'/wp/v2/widget-types'     => 'plugins',
			'/wp-block-editor/'       => 'content',
			'/wp/v2/'                 => 'content',
			'/oembed/'                => 'content',
		);
		foreach ( $map as $prefix => $scope ) {
			if ( 0 === strpos( $path, $prefix ) ) {
				return $scope;
			}
		}
		if ( '/' === $path || '/wp/v2' === $path ) {
			return 'content';
		}
		// Third-party namespaces are treated as tools.
		return 'tools';
	}

	/**
	 * Permission callback of /proxy: scope and read-only depend on the inner request.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public static function proxy_permission( $request ) {
		$path   = (string) $request->get_param( 'path' );
		$method = strtoupper( (string) $request->get_param( 'method' ) );
		$valid  = self::validate_proxy_path( $path );
		if ( is_wp_error( $valid ) ) {
			// Still authenticate first so unauthenticated callers learn nothing.
			$auth = Diba_Bridge_Auth::authenticate( $request );
			return is_wp_error( $auth ) ? $auth : $valid;
		}
		return Diba_Bridge_Auth::authorize( $request, self::proxy_scope( $path ), 'read', 'GET' !== $method );
	}

	/**
	 * POST /proxy — run a core REST request internally as the acting user.
	 * Core controllers keep enforcing their own capability checks.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function proxy( $request ) {
		$method = strtoupper( (string) $request->get_param( 'method' ) );
		$path   = (string) $request->get_param( 'path' );
		$query  = $request->get_param( 'query' );
		$body   = $request->get_param( 'body' );

		if ( ! in_array( $method, array( 'GET', 'POST', 'PUT', 'PATCH', 'DELETE' ), true ) ) {
			$method = 'GET';
		}

		$inner = new WP_REST_Request( $method, $path );

		if ( is_array( $query ) && ! empty( $query ) ) {
			$clean = array();
			foreach ( $query as $name => $value ) {
				$name = (string) $name;
				if ( '' === $name || strlen( $name ) > 100 ) {
					continue;
				}
				$clean[ $name ] = is_array( $value ) ? array_map( 'strval', array_filter( $value, 'is_scalar' ) ) : ( is_scalar( $value ) ? (string) $value : '' );
			}
			$inner->set_query_params( $clean );
		}

		if ( 'GET' !== $method && is_array( $body ) ) {
			$inner->set_header( 'Content-Type', 'application/json' );
			$inner->set_body( wp_json_encode( $body ) );
		}

		$response = rest_do_request( $inner );
		$server   = rest_get_server();
		$data     = $server->response_to_data( $response, false );
		$out      = new WP_REST_Response( $data, $response->get_status() );

		$headers = $response->get_headers();
		foreach ( array( 'X-WP-Total', 'X-WP-TotalPages' ) as $name ) {
			if ( isset( $headers[ $name ] ) ) {
				$out->header( $name, (string) $headers[ $name ] );
			}
		}

		return $out;
	}

	/**
	 * POST /media — multipart upload into the media library.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function upload_media( $request ) {
		$files = $request->get_file_params();
		if ( empty( $files['file'] ) || ! is_array( $files['file'] ) || ! empty( $files['file']['error'] ) ) {
			return new WP_Error( 'diba_bridge_no_file', __( 'فایلی برای آپلود دریافت نشد.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		$post_id = absint( $request->get_param( 'post' ) );
		if ( $post_id && ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error( 'diba_bridge_forbidden', __( 'اجازه‌ی پیوست کردن فایل به این نوشته را ندارید.', 'diba-bridge-connector' ), array( 'status' => 403 ) );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$post_data = array();
		$title     = (string) $request->get_param( 'title' );
		$caption   = (string) $request->get_param( 'caption' );
		if ( '' !== $title ) {
			$post_data['post_title'] = $title;
		}
		if ( '' !== $caption ) {
			$post_data['post_excerpt'] = $caption;
		}

		// WordPress validates the file type against the allowed mime list.
		$attachment_id = media_handle_upload( 'file', $post_id, $post_data, array( 'test_form' => false ) );
		if ( is_wp_error( $attachment_id ) ) {
			$attachment_id->add_data( array( 'status' => 400 ) );
			return $attachment_id;
		}

		$alt = (string) $request->get_param( 'alt_text' );
		if ( '' !== $alt ) {
			update_post_meta( $attachment_id, '_wp_attachment_image_alt', $alt );
		}

		$inner    = new WP_REST_Request( 'GET', '/wp/v2/media/' . (int) $attachment_id );
		$response = rest_do_request( $inner );
		if ( $response->is_error() ) {
			return rest_ensure_response(
				array(
					'id'         => (int) $attachment_id,
					'source_url' => wp_get_attachment_url( $attachment_id ),
					'mime_type'  => get_post_mime_type( $attachment_id ),
				)
			);
		}
		return new WP_REST_Response( rest_get_server()->response_to_data( $response, false ), 201 );
	}

	/**
	 * POST /themes/activate.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function activate_theme( $request ) {
		$stylesheet = sanitize_text_field( (string) $request->get_param( 'stylesheet' ) );
		$theme      = wp_get_theme( $stylesheet );

		if ( ! $theme->exists() || $theme->errors() ) {
			return new WP_Error( 'diba_bridge_theme_not_found', __( 'پوسته‌ای با این نام نصب نیست یا خراب است.', 'diba-bridge-connector' ), array( 'status' => 404 ) );
		}
		if ( ! $theme->is_allowed() ) {
			return new WP_Error( 'diba_bridge_theme_not_allowed', __( 'این پوسته برای این سایت مجاز نیست.', 'diba-bridge-connector' ), array( 'status' => 403 ) );
		}

		$previous = get_stylesheet();
		if ( $previous !== $theme->get_stylesheet() ) {
			switch_theme( $theme->get_stylesheet() );
		}

		return rest_ensure_response(
			array(
				'ok'       => true,
				'active'   => $theme->get_stylesheet(),
				'name'     => $theme->get( 'Name' ),
				'previous' => $previous,
			)
		);
	}

	/**
	 * GET /menus.
	 *
	 * @return WP_REST_Response
	 */
	public static function list_menus() {
		$locations = (array) get_nav_menu_locations();
		$items     = array();
		foreach ( wp_get_nav_menus() as $menu ) {
			$items[] = array(
				'id'          => (int) $menu->term_id,
				'name'        => (string) $menu->name,
				'slug'        => (string) $menu->slug,
				'description' => (string) $menu->description,
				'count'       => (int) $menu->count,
				'locations'   => array_keys( $locations, (int) $menu->term_id, true ),
			);
		}
		return rest_ensure_response(
			array(
				'count' => count( $items ),
				'items' => $items,
			)
		);
	}

	/**
	 * GET /menus/{id}/items.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function menu_items( $request ) {
		$menu_id = absint( $request['id'] );
		$menu    = wp_get_nav_menu_object( $menu_id );
		if ( ! $menu ) {
			return new WP_Error( 'diba_bridge_menu_not_found', __( 'فهرستی با این شناسه پیدا نشد.', 'diba-bridge-connector' ), array( 'status' => 404 ) );
		}

		$items = array();
		foreach ( (array) wp_get_nav_menu_items( $menu_id ) as $item ) {
			$items[] = array(
				'id'         => (int) $item->ID,
				'title'      => wp_strip_all_tags( (string) $item->title ),
				'url'        => (string) $item->url,
				'type'       => (string) $item->type,
				'object'     => (string) $item->object,
				'object_id'  => (int) $item->object_id,
				'parent'     => (int) $item->menu_item_parent,
				'menu_order' => (int) $item->menu_order,
				'target'     => (string) $item->target,
			);
		}

		return rest_ensure_response(
			array(
				'menu'  => $menu_id,
				'count' => count( $items ),
				'items' => $items,
			)
		);
	}
}
