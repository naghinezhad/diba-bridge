<?php
/**
 * Request authentication and authorization.
 *
 * @package DibaBridgeConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Verifies the X-Diba-Bridge-Key header, then runs the request as the
 * configured WordPress user. The key never bypasses capabilities: every
 * route still calls current_user_can() for the acting user.
 */
class Diba_Bridge_Auth {

	const HEADER           = 'x_diba_bridge_key';
	const FAIL_LIMIT       = 10;
	const FAIL_WINDOW      = 300;
	const RATE_WINDOW      = 60;
	const TRANSIENT_PREFIX = 'diba_bridge_rl_';

	/**
	 * Result of the key check for the current HTTP request (true or WP_Error).
	 *
	 * @var true|WP_Error|null
	 */
	private static $auth_result = null;

	/**
	 * Hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_filter( 'rest_request_after_callbacks', array( __CLASS__, 'log_request' ), 10, 3 );
		add_filter( 'rest_post_dispatch', array( __CLASS__, 'mark_response' ), 10, 3 );
	}

	/**
	 * Whether a route belongs to this plugin.
	 *
	 * @param string $route REST route.
	 * @return bool
	 */
	public static function is_own_route( $route ) {
		$prefix = '/' . DIBA_BRIDGE_REST_NAMESPACE;
		return $route === $prefix || 0 === strpos( (string) $route, $prefix . '/' );
	}

	/**
	 * Client IP. Only REMOTE_ADDR is trusted; forwarded headers can be spoofed.
	 *
	 * @return string
	 */
	public static function client_ip() {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '';
	}

	/**
	 * Match an IP against a single address or CIDR range (IPv4 and IPv6).
	 *
	 * @param string $ip   Client IP.
	 * @param string $rule Address or CIDR.
	 * @return bool
	 */
	public static function ip_matches( $ip, $rule ) {
		$rule = trim( (string) $rule );
		if ( '' === $ip || '' === $rule ) {
			return false;
		}
		$bits = null;
		if ( false !== strpos( $rule, '/' ) ) {
			list( $rule, $bits ) = explode( '/', $rule, 2 );
			if ( ! ctype_digit( (string) $bits ) ) {
				return false;
			}
			$bits = (int) $bits;
		}
		if ( ! filter_var( $ip, FILTER_VALIDATE_IP ) || ! filter_var( $rule, FILTER_VALIDATE_IP ) ) {
			return false;
		}
		$a = inet_pton( $ip );
		$b = inet_pton( $rule );
		if ( false === $a || false === $b || strlen( $a ) !== strlen( $b ) ) {
			return false;
		}
		if ( null === $bits ) {
			return $a === $b;
		}
		if ( $bits > strlen( $a ) * 8 ) {
			return false;
		}
		$bytes = intdiv( $bits, 8 );
		$rem   = $bits % 8;
		if ( $bytes > 0 && substr( $a, 0, $bytes ) !== substr( $b, 0, $bytes ) ) {
			return false;
		}
		if ( $rem > 0 ) {
			$mask = ( 0xFF << ( 8 - $rem ) ) & 0xFF;
			return ( ord( $a[ $bytes ] ) & $mask ) === ( ord( $b[ $bytes ] ) & $mask );
		}
		return true;
	}

	/**
	 * Validate a list of allow-list entries; returns only well-formed ones.
	 *
	 * @param string[] $rules Raw entries.
	 * @return string[]
	 */
	public static function sanitize_ip_rules( array $rules ) {
		$clean = array();
		foreach ( $rules as $rule ) {
			$rule = trim( sanitize_text_field( (string) $rule ) );
			if ( '' === $rule ) {
				continue;
			}
			$address = $rule;
			if ( false !== strpos( $rule, '/' ) ) {
				list( $address, $bits ) = explode( '/', $rule, 2 );
				if ( ! ctype_digit( (string) $bits ) || (int) $bits > 128 ) {
					continue;
				}
			}
			if ( filter_var( $address, FILTER_VALIDATE_IP ) ) {
				$clean[] = $rule;
			}
		}
		return array_values( array_unique( $clean ) );
	}

	/**
	 * Transient name of a rate-limit counter.
	 *
	 * @param string $bucket Counter name.
	 * @param int    $window Window length in seconds.
	 * @return string
	 */
	private static function counter_key( $bucket, $window ) {
		return self::TRANSIENT_PREFIX . md5( $bucket . '|' . (int) floor( time() / $window ) );
	}

	/**
	 * Current value of a counter.
	 *
	 * @param string $bucket Counter name.
	 * @param int    $window Window length in seconds.
	 * @return int
	 */
	private static function counter_get( $bucket, $window ) {
		return (int) get_transient( self::counter_key( $bucket, $window ) );
	}

	/**
	 * Increment a counter.
	 *
	 * @param string $bucket Counter name.
	 * @param int    $window Window length in seconds.
	 * @return void
	 */
	private static function counter_bump( $bucket, $window ) {
		$key = self::counter_key( $bucket, $window );
		set_transient( $key, (int) get_transient( $key ) + 1, $window * 2 );
	}

	/**
	 * Build a REST error.
	 *
	 * @param string $code    Error code.
	 * @param string $message Translated message.
	 * @param int    $status  HTTP status.
	 * @return WP_Error
	 */
	public static function error( $code, $message, $status ) {
		return new WP_Error( $code, $message, array( 'status' => $status ) );
	}

	/**
	 * Verify transport, IP, key and rate limit, then switch to the configured user.
	 * The result is cached for the rest of this HTTP request.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public static function authenticate( $request ) {
		if ( null !== self::$auth_result ) {
			return self::$auth_result;
		}
		self::$auth_result = self::do_authenticate( $request );
		return self::$auth_result;
	}

	/**
	 * Uncached authentication.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	private static function do_authenticate( $request ) {
		$settings = Diba_Bridge_Settings::get();
		$ip       = self::client_ip();

		if ( ! Diba_Bridge_Settings::has_key() ) {
			return self::error( 'diba_bridge_not_configured', __( 'هنوز کلیدی برای افزونه‌ی Diba Bridge ساخته نشده است.', 'diba-bridge-connector' ), 403 );
		}

		if ( ! is_ssl() && ! $settings['allow_http'] ) {
			return self::error( 'diba_bridge_https_required', __( 'اتصال فقط از طریق HTTPS پذیرفته می‌شود. برای محیط توسعه‌ی محلی می‌توانید HTTP را در تنظیمات افزونه مجاز کنید.', 'diba-bridge-connector' ), 403 );
		}

		if ( ! empty( $settings['ip_allowlist'] ) ) {
			$allowed = false;
			foreach ( $settings['ip_allowlist'] as $rule ) {
				if ( self::ip_matches( $ip, $rule ) ) {
					$allowed = true;
					break;
				}
			}
			if ( ! $allowed ) {
				return self::error( 'diba_bridge_ip_denied', __( 'این نشانی IP در فهرست مجاز افزونه نیست.', 'diba-bridge-connector' ), 403 );
			}
		}

		$fail_bucket = 'fail|' . $ip;
		if ( self::counter_get( $fail_bucket, self::FAIL_WINDOW ) >= self::FAIL_LIMIT ) {
			return self::error( 'diba_bridge_too_many_failures', __( 'تلاش‌های ناموفق بیش از حد؛ چند دقیقه‌ی دیگر دوباره تلاش کنید.', 'diba-bridge-connector' ), 429 );
		}

		$key = $request->get_header( self::HEADER );
		if ( ! is_string( $key ) || '' === $key ) {
			return self::error( 'diba_bridge_missing_key', __( 'هدر X-Diba-Bridge-Key فرستاده نشده است.', 'diba-bridge-connector' ), 401 );
		}
		if ( ! Diba_Bridge_Settings::verify_key( $key ) ) {
			self::counter_bump( $fail_bucket, self::FAIL_WINDOW );
			return self::error( 'diba_bridge_invalid_key', __( 'کلید افزونه‌ی Diba Bridge نادرست است.', 'diba-bridge-connector' ), 401 );
		}

		if ( self::counter_get( 'rate', self::RATE_WINDOW ) >= (int) $settings['rate_limit'] ) {
			return self::error( 'diba_bridge_rate_limited', __( 'تعداد درخواست‌ها از سقف مجاز در دقیقه بیشتر شده است.', 'diba-bridge-connector' ), 429 );
		}
		self::counter_bump( 'rate', self::RATE_WINDOW );

		$user = $settings['user_id'] ? get_userdata( $settings['user_id'] ) : false;
		if ( ! $user || ! $user->exists() ) {
			return self::error( 'diba_bridge_no_user', __( 'کاربر اجرای درخواست‌ها در تنظیمات افزونه انتخاب نشده یا حذف شده است.', 'diba-bridge-connector' ), 403 );
		}

		wp_set_current_user( $user->ID );
		return true;
	}

	/**
	 * Full authorization for one route.
	 *
	 * @param WP_REST_Request $request    Request.
	 * @param string|null     $scope      Scope that must be enabled (null = none).
	 * @param string          $capability Capability the acting user must have.
	 * @param bool            $write      Whether the route changes data.
	 * @return true|WP_Error
	 */
	public static function authorize( $request, $scope, $capability, $write ) {
		$auth = self::authenticate( $request );
		if ( is_wp_error( $auth ) ) {
			return $auth;
		}

		$settings = Diba_Bridge_Settings::get();

		if ( null !== $scope && ! in_array( $scope, $settings['scopes'], true ) ) {
			return self::error(
				'diba_bridge_scope_disabled',
				/* translators: %s: scope slug */
				sprintf( __( 'دسترسی «%s» در تنظیمات افزونه‌ی Diba Bridge غیرفعال است.', 'diba-bridge-connector' ), $scope ),
				403
			);
		}

		if ( $write && $settings['read_only'] ) {
			return self::error( 'diba_bridge_read_only', __( 'افزونه‌ی Diba Bridge در حالت فقط‌خواندنی است.', 'diba-bridge-connector' ), 403 );
		}

		if ( ! current_user_can( $capability ) ) {
			return self::error( 'diba_bridge_forbidden', __( 'کاربر اجرای درخواست‌ها دسترسی لازم برای این کار را ندارد.', 'diba-bridge-connector' ), 403 );
		}

		return true;
	}

	/**
	 * Permission callback factory.
	 *
	 * @param string|null $scope      Scope slug.
	 * @param string      $capability Required capability.
	 * @param bool        $write      Whether the route changes data.
	 * @return callable
	 */
	public static function permission( $scope, $capability, $write = false ) {
		return static function ( $request ) use ( $scope, $capability, $write ) {
			return Diba_Bridge_Auth::authorize( $request, $scope, $capability, $write );
		};
	}

	/**
	 * Audit every request to this plugin's routes (allowed or refused).
	 *
	 * @param WP_REST_Response|WP_HTTP_Response|WP_Error|mixed $response Result.
	 * @param array                                            $handler  Route handler.
	 * @param WP_REST_Request                                  $request  Request.
	 * @return mixed
	 */
	public static function log_request( $response, $handler, $request ) {
		$route = $request->get_route();
		if ( ! self::is_own_route( $route ) ) {
			return $response;
		}

		$status = 200;
		$detail = '';
		if ( is_wp_error( $response ) ) {
			$data   = $response->get_error_data();
			$status = ( is_array( $data ) && isset( $data['status'] ) ) ? (int) $data['status'] : 500;
			$detail = $response->get_error_code();
		} elseif ( $response instanceof WP_HTTP_Response ) {
			$status = (int) $response->get_status();
		}

		if ( '/' . DIBA_BRIDGE_REST_NAMESPACE . '/proxy' === $route ) {
			$inner  = strtoupper( sanitize_key( (string) $request->get_param( 'method' ) ) ) . ' ' . sanitize_text_field( (string) $request->get_param( 'path' ) );
			$detail = trim( $inner . ' ' . $detail );
		}

		// Do not let a flood of refused requests fill the table.
		if ( $status >= 400 ) {
			$bucket = 'logerr|' . self::client_ip();
			if ( self::counter_get( $bucket, self::RATE_WINDOW ) >= 30 ) {
				return $response;
			}
			self::counter_bump( $bucket, self::RATE_WINDOW );
		}

		Diba_Bridge_Audit_Log::add( $request->get_method(), $route, $status, $detail );
		return $response;
	}

	/**
	 * Mark responses of this plugin so the client can tell them from core errors.
	 *
	 * @param WP_HTTP_Response $result  Response.
	 * @param WP_REST_Server   $server  Server.
	 * @param WP_REST_Request  $request Request.
	 * @return WP_HTTP_Response
	 */
	public static function mark_response( $result, $server, $request ) {
		if ( $result instanceof WP_HTTP_Response && self::is_own_route( $request->get_route() ) ) {
			$result->header( 'X-Diba-Bridge-Connector', DIBA_BRIDGE_VERSION );
			$result->header( 'Cache-Control', 'no-store, private' );
		}
		return $result;
	}
}
