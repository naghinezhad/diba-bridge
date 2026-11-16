<?php
/**
 * SEO module: per-post SEO meta for Yoast SEO and Rank Math.
 * Routes are registered only while one of those plugins is active.
 *
 * @package DibaBridgeConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * SEO meta controller.
 */
class Diba_Bridge_SEO {

	/**
	 * Whether a supported SEO plugin is active.
	 *
	 * @return bool
	 */
	public static function is_available() {
		return null !== Diba_Bridge_REST::seo_plugin();
	}

	/**
	 * Meta keys of the active plugin, keyed by the unified field name.
	 *
	 * @return array<string,string>
	 */
	private static function meta_keys() {
		if ( 'yoast' === Diba_Bridge_REST::seo_plugin() ) {
			return array(
				'title'          => '_yoast_wpseo_title',
				'description'    => '_yoast_wpseo_metadesc',
				'focus_keyword'  => '_yoast_wpseo_focuskw',
				'canonical'      => '_yoast_wpseo_canonical',
				'og_title'       => '_yoast_wpseo_opengraph-title',
				'og_description' => '_yoast_wpseo_opengraph-description',
			);
		}
		return array(
			'title'          => 'rank_math_title',
			'description'    => 'rank_math_description',
			'focus_keyword'  => 'rank_math_focus_keyword',
			'canonical'      => 'rank_math_canonical_url',
			'og_title'       => 'rank_math_facebook_title',
			'og_description' => 'rank_math_facebook_description',
		);
	}

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public static function register_routes() {
		$text = array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
		);

		register_rest_route(
			DIBA_BRIDGE_REST_NAMESPACE,
			'/seo/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'get_meta' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'content', 'edit_posts' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'update_meta' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'content', 'edit_posts', true ),
					'args'                => array(
						'title'          => $text,
						'description'    => $text,
						'focus_keyword'  => $text,
						'og_title'       => $text,
						'og_description' => $text,
						// Sanitized with esc_url_raw() in the handler.
						'canonical'      => array(
							'type' => 'string',
						),
						'noindex'        => array(
							'type' => 'boolean',
						),
					),
				),
			)
		);
	}

	/**
	 * Load the post and check object-level permission.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_Post|WP_Error
	 */
	private static function get_post( $request ) {
		$post = get_post( absint( $request['id'] ) );
		if ( ! $post || 'revision' === $post->post_type ) {
			return new WP_Error( 'diba_bridge_post_not_found', __( 'نوشته‌ای با این شناسه پیدا نشد.', 'diba-bridge-connector' ), array( 'status' => 404 ) );
		}
		if ( ! current_user_can( 'edit_post', $post->ID ) ) {
			return new WP_Error( 'diba_bridge_forbidden', __( 'اجازه‌ی ویرایش این نوشته را ندارید.', 'diba-bridge-connector' ), array( 'status' => 403 ) );
		}
		return $post;
	}

	/**
	 * Whether the post is set to noindex.
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 */
	private static function is_noindex( $post_id ) {
		if ( 'yoast' === Diba_Bridge_REST::seo_plugin() ) {
			return '1' === (string) get_post_meta( $post_id, '_yoast_wpseo_meta-robots-noindex', true );
		}
		$robots = get_post_meta( $post_id, 'rank_math_robots', true );
		return is_array( $robots ) && in_array( 'noindex', $robots, true );
	}

	/**
	 * Build the response for one post.
	 *
	 * @param WP_Post $post Post.
	 * @return array<string,mixed>
	 */
	private static function describe( $post ) {
		$out = array(
			'id'         => (int) $post->ID,
			'plugin'     => Diba_Bridge_REST::seo_plugin(),
			'post_title' => wp_strip_all_tags( get_the_title( $post ) ),
			'permalink'  => get_permalink( $post ),
		);
		foreach ( self::meta_keys() as $field => $meta_key ) {
			$out[ $field ] = (string) get_post_meta( $post->ID, $meta_key, true );
		}
		$out['noindex'] = self::is_noindex( $post->ID );
		return $out;
	}

	/**
	 * GET /seo/{id}.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function get_meta( $request ) {
		$post = self::get_post( $request );
		if ( is_wp_error( $post ) ) {
			return $post;
		}
		return rest_ensure_response( self::describe( $post ) );
	}

	/**
	 * POST /seo/{id}. An empty string clears a field.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function update_meta( $request ) {
		$post = self::get_post( $request );
		if ( is_wp_error( $post ) ) {
			return $post;
		}

		foreach ( self::meta_keys() as $field => $meta_key ) {
			$value = $request->get_param( $field );
			if ( null === $value ) {
				continue;
			}
			$value = 'canonical' === $field ? esc_url_raw( (string) $value ) : sanitize_text_field( (string) $value );
			if ( '' === $value ) {
				delete_post_meta( $post->ID, $meta_key );
			} else {
				update_post_meta( $post->ID, $meta_key, wp_slash( $value ) );
			}
		}

		$noindex = $request->get_param( 'noindex' );
		if ( null !== $noindex ) {
			$noindex = (bool) $noindex;
			if ( 'yoast' === Diba_Bridge_REST::seo_plugin() ) {
				if ( $noindex ) {
					update_post_meta( $post->ID, '_yoast_wpseo_meta-robots-noindex', '1' );
				} else {
					delete_post_meta( $post->ID, '_yoast_wpseo_meta-robots-noindex' );
				}
			} else {
				$robots = get_post_meta( $post->ID, 'rank_math_robots', true );
				$robots = is_array( $robots ) ? array_values( array_diff( $robots, array( 'index', 'noindex' ) ) ) : array();
				array_unshift( $robots, $noindex ? 'noindex' : 'index' );
				update_post_meta( $post->ID, 'rank_math_robots', $robots );
			}
		}

		clean_post_cache( $post->ID );

		return rest_ensure_response( array_merge( array( 'ok' => true ), self::describe( $post ) ) );
	}
}
