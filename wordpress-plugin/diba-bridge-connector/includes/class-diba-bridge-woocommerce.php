<?php
/**
 * WooCommerce module. Routes are registered only while WooCommerce is active
 * and everything goes through the public WooCommerce CRUD API
 * (wc_get_products, wc_get_order, WC_Coupon, WC_Customer), so it works with
 * both legacy and High-Performance Order Storage.
 *
 * @package DibaBridgeConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * WooCommerce controller.
 */
class Diba_Bridge_WooCommerce {

	/**
	 * Whether WooCommerce is active.
	 *
	 * @return bool
	 */
	public static function is_available() {
		return class_exists( 'WooCommerce' ) && function_exists( 'wc_get_products' ) && function_exists( 'wc_get_orders' );
	}

	/**
	 * Shared pagination args.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	private static function paging_args() {
		return array(
			'page'     => array(
				'type'    => 'integer',
				'default' => 1,
				'minimum' => 1,
			),
			'per_page' => array(
				'type'    => 'integer',
				'default' => 10,
				'minimum' => 1,
				'maximum' => 100,
			),
			'search'   => array(
				'type'              => 'string',
				'sanitize_callback' => 'sanitize_text_field',
			),
		);
	}

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public static function register_routes() {
		$ns     = DIBA_BRIDGE_REST_NAMESPACE;
		$id_arg = array(
			'id' => array(
				'type'              => 'integer',
				'sanitize_callback' => 'absint',
			),
		);

		register_rest_route(
			$ns,
			'/wc/products',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'list_products' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'edit_products' ),
					'args'                => array_merge(
						self::paging_args(),
						array(
							'status'       => array(
								'type' => 'string',
								'enum' => array( 'publish', 'draft', 'pending', 'private', 'any' ),
							),
							'type'         => array(
								'type' => 'string',
								'enum' => array( 'simple', 'variable', 'grouped', 'external' ),
							),
							// Sanitized with sanitize_title() in the handler.
							'category'     => array(
								'type' => 'string',
							),
							'sku'          => array(
								'type'              => 'string',
								'sanitize_callback' => 'sanitize_text_field',
							),
							'stock_status' => array(
								'type' => 'string',
								'enum' => array( 'instock', 'outofstock', 'onbackorder' ),
							),
							'orderby'      => array(
								'type'    => 'string',
								'enum'    => array( 'date', 'modified', 'title', 'id' ),
								'default' => 'date',
							),
							'order'        => array(
								'type'    => 'string',
								'enum'    => array( 'asc', 'desc' ),
								'default' => 'desc',
							),
						)
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'create_product' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'edit_products', true ),
					'args'                => array(
						'name' => array(
							'type'     => 'string',
							'required' => true,
						),
						'type' => array(
							'type'    => 'string',
							'enum'    => array( 'simple', 'external', 'grouped', 'variable' ),
							'default' => 'simple',
						),
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/wc/products/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'get_product' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'edit_products' ),
					'args'                => $id_arg,
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'update_product' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'edit_products', true ),
					'args'                => $id_arg,
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( __CLASS__, 'delete_product' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'delete_products', true ),
					'args'                => array_merge(
						$id_arg,
						array(
							'force' => array(
								'type'    => 'boolean',
								'default' => false,
							),
						)
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/wc/orders',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'list_orders' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'edit_shop_orders' ),
				'args'                => array_merge(
					self::paging_args(),
					array(
						'status'   => array(
							'type'    => 'string',
							'pattern' => '^[a-z0-9_,-]*$',
						),
						'customer' => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'after'    => array(
							'type'    => 'string',
							'pattern' => '^\d{4}-\d{2}-\d{2}$',
						),
						'before'   => array(
							'type'    => 'string',
							'pattern' => '^\d{4}-\d{2}-\d{2}$',
						),
					)
				),
			)
		);

		register_rest_route(
			$ns,
			'/wc/orders/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'get_order' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'edit_shop_orders' ),
					'args'                => $id_arg,
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'update_order' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'edit_shop_orders', true ),
					'args'                => array_merge(
						$id_arg,
						array(
							'status'        => array(
								'type'    => 'string',
								'pattern' => '^[a-z0-9_-]{1,40}$',
							),
							'note'          => array(
								'type'      => 'string',
								'maxLength' => 2000,
							),
							'customer_note' => array(
								'type'    => 'boolean',
								'default' => false,
							),
						)
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/wc/customers',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'list_customers' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'list_users' ),
				'args'                => self::paging_args(),
			)
		);

		register_rest_route(
			$ns,
			'/wc/coupons',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'list_coupons' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'edit_shop_coupons' ),
					'args'                => self::paging_args(),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'create_coupon' ),
					'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'publish_shop_coupons', true ),
					'args'                => array(
						'code'          => array(
							'type'      => 'string',
							'required'  => true,
							'minLength' => 1,
							'maxLength' => 100,
						),
						'amount'        => array(
							'required' => true,
						),
						'discount_type' => array(
							'type'    => 'string',
							'default' => 'fixed_cart',
						),
						'date_expires'  => array(
							'type'    => 'string',
							'pattern' => '^\d{4}-\d{2}-\d{2}$',
						),
					),
				),
			)
		);

		register_rest_route(
			$ns,
			'/wc/reports/sales',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'sales_report' ),
				'permission_callback' => Diba_Bridge_Auth::permission( 'woocommerce', 'view_woocommerce_reports' ),
				'args'                => array(
					'from' => array(
						'type'    => 'string',
						'pattern' => '^\d{4}-\d{2}-\d{2}$',
					),
					'to'   => array(
						'type'    => 'string',
						'pattern' => '^\d{4}-\d{2}-\d{2}$',
					),
				),
			)
		);
	}

	/**
	 * Standard paginated list response.
	 *
	 * @param array $items    Items.
	 * @param int   $total    Total matches.
	 * @param int   $page     Page.
	 * @param int   $per_page Page size.
	 * @return WP_REST_Response
	 */
	private static function paged( array $items, $total, $page, $per_page ) {
		return rest_ensure_response(
			array(
				'total'       => (int) $total,
				'total_pages' => (int) ceil( $total / max( 1, $per_page ) ),
				'page'        => (int) $page,
				'per_page'    => (int) $per_page,
				'count'       => count( $items ),
				'items'       => $items,
			)
		);
	}

	/**
	 * Format a WooCommerce date.
	 *
	 * @param WC_DateTime|null $date Date.
	 * @return string|null
	 */
	private static function date( $date ) {
		return $date ? $date->date( 'c' ) : null;
	}

	/**
	 * Not-found error.
	 *
	 * @param string $message Message.
	 * @return WP_Error
	 */
	private static function not_found( $message ) {
		return new WP_Error( 'diba_bridge_wc_not_found', $message, array( 'status' => 404 ) );
	}

	// ------------------------------------------------------------------
	// Products
	// ------------------------------------------------------------------

	/**
	 * Compact product data.
	 *
	 * @param WC_Product $product Product.
	 * @param bool       $full    Include long fields.
	 * @return array<string,mixed>
	 */
	private static function format_product( $product, $full = false ) {
		$image_id = (int) $product->get_image_id();
		$terms    = get_the_terms( $product->get_id(), 'product_cat' );
		$out      = array(
			'id'             => (int) $product->get_id(),
			'name'           => $product->get_name(),
			'type'           => $product->get_type(),
			'status'         => $product->get_status(),
			'sku'            => $product->get_sku(),
			'price'          => $product->get_price(),
			'regular_price'  => $product->get_regular_price(),
			'sale_price'     => $product->get_sale_price(),
			'stock_status'   => $product->get_stock_status(),
			'stock_quantity' => $product->get_stock_quantity(),
			'manage_stock'   => (bool) $product->get_manage_stock(),
			'permalink'      => $product->get_permalink(),
			'categories'     => is_array( $terms ) ? array_values( wp_list_pluck( $terms, 'name' ) ) : array(),
			'image'          => $image_id ? wp_get_attachment_url( $image_id ) : null,
			'date_modified'  => self::date( $product->get_date_modified() ),
		);

		if ( $full ) {
			$attributes = array();
			foreach ( (array) $product->get_attributes() as $attribute ) {
				if ( $attribute instanceof WC_Product_Attribute ) {
					$options = $attribute->is_taxonomy()
						? wc_get_product_terms( $product->get_id(), $attribute->get_name(), array( 'fields' => 'names' ) )
						: $attribute->get_options();
					$attributes[] = array(
						'name'      => wc_attribute_label( $attribute->get_name() ),
						'options'   => array_values( (array) $options ),
						'variation' => (bool) $attribute->get_variation(),
					);
				}
			}

			$out['slug']              = $product->get_slug();
			$out['description']       = $product->get_description();
			$out['short_description'] = $product->get_short_description();
			$out['featured']          = (bool) $product->get_featured();
			$out['virtual']           = (bool) $product->get_virtual();
			$out['weight']            = $product->get_weight();
			$out['category_ids']      = array_map( 'intval', (array) $product->get_category_ids() );
			$out['tag_ids']           = array_map( 'intval', (array) $product->get_tag_ids() );
			$out['image_id']          = $image_id;
			$out['gallery_image_ids'] = array_map( 'intval', (array) $product->get_gallery_image_ids() );
			$out['attributes']        = $attributes;
			$out['variation_ids']     = $product->is_type( 'variable' ) ? array_map( 'intval', (array) $product->get_children() ) : array();
			$out['total_sales']       = (int) $product->get_total_sales();
			$out['date_created']      = self::date( $product->get_date_created() );
		}

		return $out;
	}

	/**
	 * GET /wc/products.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function list_products( $request ) {
		$per_page = max( 1, min( 100, absint( $request->get_param( 'per_page' ) ) ) );
		$page     = max( 1, absint( $request->get_param( 'page' ) ) );
		$status   = (string) $request->get_param( 'status' );
		$orderby  = array(
			'date'     => 'date',
			'modified' => 'modified',
			'title'    => 'title',
			'id'       => 'ID',
		);
		$order_by = (string) $request->get_param( 'orderby' );

		$args = array(
			'limit'    => $per_page,
			'page'     => $page,
			'paginate' => true,
			'return'   => 'objects',
			'status'   => ( '' === $status || 'any' === $status ) ? array( 'publish', 'draft', 'pending', 'private' ) : $status,
			'orderby'  => isset( $orderby[ $order_by ] ) ? $orderby[ $order_by ] : 'date',
			'order'    => 'asc' === $request->get_param( 'order' ) ? 'ASC' : 'DESC',
		);

		foreach ( array( 'type', 'sku', 'stock_status' ) as $key ) {
			$value = (string) $request->get_param( $key );
			if ( '' !== $value ) {
				$args[ $key ] = $value;
			}
		}
		$category = sanitize_title( (string) $request->get_param( 'category' ) );
		if ( '' !== $category ) {
			$args['category'] = array( $category );
		}
		$search = (string) $request->get_param( 'search' );
		if ( '' !== $search ) {
			$args['s'] = $search;
		}

		$result = wc_get_products( $args );
		$items  = array();
		foreach ( (array) $result->products as $product ) {
			if ( $product instanceof WC_Product ) {
				$items[] = self::format_product( $product );
			}
		}

		return self::paged( $items, (int) $result->total, $page, $per_page );
	}

	/**
	 * Load a product and check object-level permission.
	 *
	 * @param WP_REST_Request $request    Request.
	 * @param string          $capability Meta capability.
	 * @return WC_Product|WP_Error
	 */
	private static function load_product( $request, $capability ) {
		$id      = absint( $request['id'] );
		$product = $id ? wc_get_product( $id ) : false;
		if ( ! $product instanceof WC_Product ) {
			return self::not_found( __( 'محصولی با این شناسه پیدا نشد.', 'diba-bridge-connector' ) );
		}
		if ( ! current_user_can( $capability, $id ) ) {
			return new WP_Error( 'diba_bridge_forbidden', __( 'اجازه‌ی این کار روی این محصول را ندارید.', 'diba-bridge-connector' ), array( 'status' => 403 ) );
		}
		return $product;
	}

	/**
	 * GET /wc/products/{id}.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function get_product( $request ) {
		$product = self::load_product( $request, 'edit_post' );
		if ( is_wp_error( $product ) ) {
			return $product;
		}
		return rest_ensure_response( self::format_product( $product, true ) );
	}

	/**
	 * Copy request fields onto a product.
	 *
	 * @param WC_Product      $product Product.
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	private static function apply_product_props( $product, $request ) {
		$status = $request->get_param( 'status' );
		if ( null !== $status ) {
			$status = sanitize_key( (string) $status );
			if ( ! in_array( $status, array( 'draft', 'publish', 'pending', 'private' ), true ) ) {
				return new WP_Error( 'diba_bridge_wc_invalid', __( 'وضعیت محصول نامعتبر است.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
			}
			if ( in_array( $status, array( 'publish', 'private' ), true ) && ! current_user_can( 'publish_products' ) ) {
				return new WP_Error( 'diba_bridge_forbidden', __( 'اجازه‌ی انتشار محصول را ندارید.', 'diba-bridge-connector' ), array( 'status' => 403 ) );
			}
			$product->set_status( $status );
		}

		$stock_status = $request->get_param( 'stock_status' );
		if ( null !== $stock_status && ! in_array( $stock_status, array( 'instock', 'outofstock', 'onbackorder' ), true ) ) {
			return new WP_Error( 'diba_bridge_wc_invalid', __( 'وضعیت موجودی نامعتبر است.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		try {
			if ( null !== $request->get_param( 'name' ) ) {
				$product->set_name( sanitize_text_field( (string) $request->get_param( 'name' ) ) );
			}
			if ( null !== $request->get_param( 'description' ) ) {
				$product->set_description( wp_kses_post( (string) $request->get_param( 'description' ) ) );
			}
			if ( null !== $request->get_param( 'short_description' ) ) {
				$product->set_short_description( wp_kses_post( (string) $request->get_param( 'short_description' ) ) );
			}
			if ( null !== $request->get_param( 'sku' ) ) {
				$product->set_sku( wc_clean( (string) $request->get_param( 'sku' ) ) );
			}
			if ( null !== $request->get_param( 'regular_price' ) && is_scalar( $request->get_param( 'regular_price' ) ) ) {
				$product->set_regular_price( wc_format_decimal( (string) $request->get_param( 'regular_price' ) ) );
			}
			if ( null !== $request->get_param( 'sale_price' ) && is_scalar( $request->get_param( 'sale_price' ) ) ) {
				$sale = (string) $request->get_param( 'sale_price' );
				$product->set_sale_price( '' === $sale ? '' : wc_format_decimal( $sale ) );
			}
			if ( null !== $request->get_param( 'manage_stock' ) ) {
				$product->set_manage_stock( rest_sanitize_boolean( $request->get_param( 'manage_stock' ) ) );
			}
			if ( null !== $request->get_param( 'stock_quantity' ) && is_numeric( $request->get_param( 'stock_quantity' ) ) ) {
				$product->set_stock_quantity( wc_stock_amount( $request->get_param( 'stock_quantity' ) ) );
			}
			if ( null !== $stock_status ) {
				$product->set_stock_status( $stock_status );
			}
			if ( null !== $request->get_param( 'category_ids' ) ) {
				$product->set_category_ids( array_filter( array_map( 'absint', (array) $request->get_param( 'category_ids' ) ) ) );
			}
			if ( null !== $request->get_param( 'tag_ids' ) ) {
				$product->set_tag_ids( array_filter( array_map( 'absint', (array) $request->get_param( 'tag_ids' ) ) ) );
			}
			if ( null !== $request->get_param( 'image_id' ) ) {
				$product->set_image_id( absint( $request->get_param( 'image_id' ) ) );
			}
			if ( null !== $request->get_param( 'gallery_image_ids' ) ) {
				$product->set_gallery_image_ids( array_filter( array_map( 'absint', (array) $request->get_param( 'gallery_image_ids' ) ) ) );
			}
			if ( null !== $request->get_param( 'featured' ) ) {
				$product->set_featured( rest_sanitize_boolean( $request->get_param( 'featured' ) ) );
			}
			if ( null !== $request->get_param( 'virtual' ) ) {
				$product->set_virtual( rest_sanitize_boolean( $request->get_param( 'virtual' ) ) );
			}
			if ( null !== $request->get_param( 'weight' ) && is_scalar( $request->get_param( 'weight' ) ) ) {
				$product->set_weight( wc_format_decimal( (string) $request->get_param( 'weight' ) ) );
			}
		} catch ( WC_Data_Exception $e ) {
			return new WP_Error( 'diba_bridge_wc_invalid', wp_strip_all_tags( $e->getMessage() ), array( 'status' => 400 ) );
		}

		return true;
	}

	/**
	 * POST /wc/products.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function create_product( $request ) {
		$type = sanitize_key( (string) $request->get_param( 'type' ) );
		if ( ! in_array( $type, array( 'simple', 'external', 'grouped', 'variable' ), true ) ) {
			$type = 'simple';
		}
		$class   = WC_Product_Factory::get_classname_from_product_type( $type );
		$product = ( $class && class_exists( $class ) ) ? new $class() : new WC_Product_Simple();

		if ( null === $request->get_param( 'status' ) ) {
			$product->set_status( 'draft' );
		}

		$applied = self::apply_product_props( $product, $request );
		if ( is_wp_error( $applied ) ) {
			return $applied;
		}

		try {
			$product->save();
		} catch ( Exception $e ) {
			return new WP_Error( 'diba_bridge_wc_invalid', wp_strip_all_tags( $e->getMessage() ), array( 'status' => 400 ) );
		}

		$response = rest_ensure_response(
			array(
				'ok'      => true,
				'product' => self::format_product( wc_get_product( $product->get_id() ), true ),
			)
		);
		$response->set_status( 201 );
		return $response;
	}

	/**
	 * POST /wc/products/{id}.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function update_product( $request ) {
		$product = self::load_product( $request, 'edit_post' );
		if ( is_wp_error( $product ) ) {
			return $product;
		}

		$applied = self::apply_product_props( $product, $request );
		if ( is_wp_error( $applied ) ) {
			return $applied;
		}

		try {
			$product->save();
		} catch ( Exception $e ) {
			return new WP_Error( 'diba_bridge_wc_invalid', wp_strip_all_tags( $e->getMessage() ), array( 'status' => 400 ) );
		}

		return rest_ensure_response(
			array(
				'ok'      => true,
				'product' => self::format_product( wc_get_product( $product->get_id() ), true ),
			)
		);
	}

	/**
	 * DELETE /wc/products/{id}.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function delete_product( $request ) {
		$product = self::load_product( $request, 'delete_post' );
		if ( is_wp_error( $product ) ) {
			return $product;
		}

		$id    = (int) $product->get_id();
		$force = (bool) $request->get_param( 'force' );
		$product->delete( $force );

		return rest_ensure_response(
			array(
				'ok'      => true,
				'id'      => $id,
				'deleted' => $force,
				'trashed' => ! $force,
			)
		);
	}

	// ------------------------------------------------------------------
	// Orders
	// ------------------------------------------------------------------

	/**
	 * Compact order data.
	 *
	 * @param WC_Order $order Order.
	 * @param bool     $full  Include line items, addresses and notes.
	 * @return array<string,mixed>
	 */
	private static function format_order( $order, $full = false ) {
		$out = array(
			'id'             => (int) $order->get_id(),
			'number'         => $order->get_order_number(),
			'status'         => $order->get_status(),
			'total'          => $order->get_total(),
			'currency'       => $order->get_currency(),
			'date_created'   => self::date( $order->get_date_created() ),
			'customer_id'    => (int) $order->get_customer_id(),
			'customer_name'  => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ),
			'customer_email' => $order->get_billing_email(),
			'customer_phone' => $order->get_billing_phone(),
			'payment_method' => $order->get_payment_method_title(),
			'items_count'    => (int) $order->get_item_count(),
		);

		if ( $full ) {
			$items = array();
			foreach ( $order->get_items() as $item ) {
				if ( ! $item instanceof WC_Order_Item_Product ) {
					continue;
				}
				$product = $item->get_product();
				$items[] = array(
					'name'         => $item->get_name(),
					'product_id'   => (int) $item->get_product_id(),
					'variation_id' => (int) $item->get_variation_id(),
					'sku'          => $product instanceof WC_Product ? $product->get_sku() : '',
					'quantity'     => (int) $item->get_quantity(),
					'total'        => $item->get_total(),
				);
			}

			$notes       = array();
			$order_notes = wc_get_order_notes(
				array(
					'order_id' => $order->get_id(),
					'limit'    => 10,
				)
			);
			foreach ( (array) $order_notes as $note ) {
				$notes[] = array(
					'date'          => self::date( $note->date_created ),
					'content'       => wp_strip_all_tags( (string) $note->content ),
					'customer_note' => (bool) $note->customer_note,
					'added_by'      => (string) $note->added_by,
				);
			}

			$out['line_items']      = $items;
			$out['shipping_total']  = $order->get_shipping_total();
			$out['discount_total']  = $order->get_discount_total();
			$out['total_tax']       = $order->get_total_tax();
			$out['total_refunded']  = $order->get_total_refunded();
			$out['date_paid']       = self::date( $order->get_date_paid() );
			$out['customer_note']   = $order->get_customer_note();
			$out['billing']         = array_filter( (array) $order->get_address( 'billing' ) );
			$out['shipping']        = array_filter( (array) $order->get_address( 'shipping' ) );
			$out['shipping_method'] = $order->get_shipping_method();
			$out['notes']           = $notes;
		}

		return $out;
	}

	/**
	 * GET /wc/orders.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function list_orders( $request ) {
		$per_page = max( 1, min( 100, absint( $request->get_param( 'per_page' ) ) ) );
		$page     = max( 1, absint( $request->get_param( 'page' ) ) );

		$args = array(
			'type'     => 'shop_order',
			'limit'    => $per_page,
			'page'     => $page,
			'paginate' => true,
			'orderby'  => 'date',
			'order'    => 'DESC',
		);

		$status = (string) $request->get_param( 'status' );
		if ( '' !== $status ) {
			$valid    = array_keys( wc_get_order_statuses() );
			$statuses = array();
			foreach ( explode( ',', $status ) as $slug ) {
				$slug = sanitize_key( $slug );
				if ( in_array( 'wc-' . $slug, $valid, true ) ) {
					$statuses[] = $slug;
				}
			}
			if ( ! empty( $statuses ) ) {
				$args['status'] = $statuses;
			}
		}

		$customer = (string) $request->get_param( 'customer' );
		if ( '' !== $customer ) {
			$args['customer'] = ctype_digit( $customer ) ? (int) $customer : sanitize_email( $customer );
		}

		$after  = (string) $request->get_param( 'after' );
		$before = (string) $request->get_param( 'before' );
		if ( '' !== $after && '' !== $before ) {
			$args['date_created'] = $after . '...' . $before;
		} elseif ( '' !== $after ) {
			$args['date_created'] = '>=' . $after;
		} elseif ( '' !== $before ) {
			$args['date_created'] = '<=' . $before;
		}

		$result = wc_get_orders( $args );
		$items  = array();
		foreach ( (array) $result->orders as $order ) {
			if ( $order instanceof WC_Order ) {
				$items[] = self::format_order( $order );
			}
		}

		return self::paged( $items, (int) $result->total, $page, $per_page );
	}

	/**
	 * Load an order (refunds are not orders here).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WC_Order|WP_Error
	 */
	private static function load_order( $request ) {
		$id    = absint( $request['id'] );
		$order = $id ? wc_get_order( $id ) : false;
		if ( ! $order instanceof WC_Order || 'shop_order' !== $order->get_type() ) {
			return self::not_found( __( 'سفارشی با این شناسه پیدا نشد.', 'diba-bridge-connector' ) );
		}
		return $order;
	}

	/**
	 * GET /wc/orders/{id}.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function get_order( $request ) {
		$order = self::load_order( $request );
		if ( is_wp_error( $order ) ) {
			return $order;
		}
		return rest_ensure_response( self::format_order( $order, true ) );
	}

	/**
	 * POST /wc/orders/{id} — change status and/or add a note.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function update_order( $request ) {
		$order = self::load_order( $request );
		if ( is_wp_error( $order ) ) {
			return $order;
		}

		$status = sanitize_key( (string) $request->get_param( 'status' ) );
		$note   = trim( wp_kses_post( (string) $request->get_param( 'note' ) ) );

		if ( '' === $status && '' === $note ) {
			return new WP_Error( 'diba_bridge_wc_invalid', __( 'وضعیت جدید یا یادداشت سفارش را بفرستید.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		$previous = $order->get_status();
		if ( '' !== $status ) {
			if ( ! array_key_exists( 'wc-' . $status, wc_get_order_statuses() ) ) {
				return new WP_Error( 'diba_bridge_wc_invalid', __( 'وضعیت سفارش نامعتبر است.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
			}
			if ( $status !== $previous ) {
				$order->update_status( $status, '', true );
			}
		}

		if ( '' !== $note ) {
			$order->add_order_note( $note, $request->get_param( 'customer_note' ) ? 1 : 0, true );
		}

		$order = wc_get_order( $order->get_id() );

		return rest_ensure_response(
			array(
				'ok'              => true,
				'previous_status' => $previous,
				'note_added'      => '' !== $note,
				'order'           => self::format_order( $order ),
			)
		);
	}

	// ------------------------------------------------------------------
	// Customers
	// ------------------------------------------------------------------

	/**
	 * GET /wc/customers.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function list_customers( $request ) {
		$per_page = max( 1, min( 100, absint( $request->get_param( 'per_page' ) ) ) );
		$page     = max( 1, absint( $request->get_param( 'page' ) ) );
		$search   = (string) $request->get_param( 'search' );

		$args = array(
			'role'    => 'customer',
			'number'  => $per_page,
			'paged'   => $page,
			'orderby' => 'registered',
			'order'   => 'DESC',
			'fields'  => 'ID',
		);
		if ( '' !== $search ) {
			$args['search']         = '*' . $search . '*';
			$args['search_columns'] = array( 'user_login', 'user_email', 'display_name' );
		}

		$query = new WP_User_Query( $args );
		$items = array();
		foreach ( (array) $query->get_results() as $user_id ) {
			$customer = new WC_Customer( (int) $user_id );
			$items[]  = array(
				'id'           => (int) $customer->get_id(),
				'username'     => $customer->get_username(),
				'email'        => $customer->get_email(),
				'name'         => trim( $customer->get_first_name() . ' ' . $customer->get_last_name() ),
				'phone'        => $customer->get_billing_phone(),
				'city'         => $customer->get_billing_city(),
				'country'      => $customer->get_billing_country(),
				'orders_count' => (int) $customer->get_order_count(),
				'total_spent'  => $customer->get_total_spent(),
				'date_created' => self::date( $customer->get_date_created() ),
			);
		}

		return self::paged( $items, (int) $query->get_total(), $page, $per_page );
	}

	// ------------------------------------------------------------------
	// Coupons
	// ------------------------------------------------------------------

	/**
	 * Compact coupon data.
	 *
	 * @param WC_Coupon $coupon Coupon.
	 * @return array<string,mixed>
	 */
	private static function format_coupon( $coupon ) {
		return array(
			'id'                   => (int) $coupon->get_id(),
			'code'                 => $coupon->get_code(),
			'discount_type'        => $coupon->get_discount_type(),
			'amount'               => $coupon->get_amount(),
			'description'          => $coupon->get_description(),
			'date_expires'         => self::date( $coupon->get_date_expires() ),
			'usage_count'          => (int) $coupon->get_usage_count(),
			'usage_limit'          => $coupon->get_usage_limit() ? (int) $coupon->get_usage_limit() : null,
			'usage_limit_per_user' => $coupon->get_usage_limit_per_user() ? (int) $coupon->get_usage_limit_per_user() : null,
			'individual_use'       => (bool) $coupon->get_individual_use(),
			'free_shipping'        => (bool) $coupon->get_free_shipping(),
			'minimum_amount'       => $coupon->get_minimum_amount(),
			'maximum_amount'       => $coupon->get_maximum_amount(),
		);
	}

	/**
	 * GET /wc/coupons.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function list_coupons( $request ) {
		$per_page = max( 1, min( 100, absint( $request->get_param( 'per_page' ) ) ) );
		$page     = max( 1, absint( $request->get_param( 'page' ) ) );
		$search   = (string) $request->get_param( 'search' );

		$args = array(
			'post_type'      => 'shop_coupon',
			'post_status'    => 'publish',
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'fields'         => 'ids',
			'orderby'        => 'date',
			'order'          => 'DESC',
		);
		if ( '' !== $search ) {
			$args['s'] = $search;
		}

		$query = new WP_Query( $args );
		$items = array();
		foreach ( (array) $query->posts as $coupon_id ) {
			$items[] = self::format_coupon( new WC_Coupon( (int) $coupon_id ) );
		}

		return self::paged( $items, (int) $query->found_posts, $page, $per_page );
	}

	/**
	 * POST /wc/coupons.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function create_coupon( $request ) {
		$code = wc_format_coupon_code( sanitize_text_field( (string) $request->get_param( 'code' ) ) );
		if ( '' === $code ) {
			return new WP_Error( 'diba_bridge_wc_invalid', __( 'کد تخفیف نامعتبر است.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}
		if ( wc_get_coupon_id_by_code( $code ) ) {
			return new WP_Error( 'diba_bridge_wc_coupon_exists', __( 'کد تخفیفی با همین نام از قبل وجود دارد.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		$type = sanitize_key( (string) $request->get_param( 'discount_type' ) );
		if ( ! array_key_exists( $type, wc_get_coupon_types() ) ) {
			return new WP_Error( 'diba_bridge_wc_invalid', __( 'نوع تخفیف نامعتبر است.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		$amount = $request->get_param( 'amount' );
		if ( ! is_scalar( $amount ) || ! is_numeric( $amount ) || (float) $amount < 0 ) {
			return new WP_Error( 'diba_bridge_wc_invalid', __( 'مقدار تخفیف نامعتبر است.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		try {
			$coupon = new WC_Coupon();
			$coupon->set_code( $code );
			$coupon->set_discount_type( $type );
			$coupon->set_amount( wc_format_decimal( (string) $amount ) );

			if ( null !== $request->get_param( 'description' ) ) {
				$coupon->set_description( sanitize_textarea_field( (string) $request->get_param( 'description' ) ) );
			}
			if ( $request->get_param( 'date_expires' ) ) {
				$coupon->set_date_expires( (string) $request->get_param( 'date_expires' ) );
			}
			if ( null !== $request->get_param( 'usage_limit' ) ) {
				$coupon->set_usage_limit( absint( $request->get_param( 'usage_limit' ) ) );
			}
			if ( null !== $request->get_param( 'usage_limit_per_user' ) ) {
				$coupon->set_usage_limit_per_user( absint( $request->get_param( 'usage_limit_per_user' ) ) );
			}
			if ( null !== $request->get_param( 'individual_use' ) ) {
				$coupon->set_individual_use( rest_sanitize_boolean( $request->get_param( 'individual_use' ) ) );
			}
			if ( null !== $request->get_param( 'free_shipping' ) ) {
				$coupon->set_free_shipping( rest_sanitize_boolean( $request->get_param( 'free_shipping' ) ) );
			}
			if ( null !== $request->get_param( 'minimum_amount' ) && is_scalar( $request->get_param( 'minimum_amount' ) ) ) {
				$coupon->set_minimum_amount( wc_format_decimal( (string) $request->get_param( 'minimum_amount' ) ) );
			}
			if ( null !== $request->get_param( 'maximum_amount' ) && is_scalar( $request->get_param( 'maximum_amount' ) ) ) {
				$coupon->set_maximum_amount( wc_format_decimal( (string) $request->get_param( 'maximum_amount' ) ) );
			}
			if ( null !== $request->get_param( 'product_ids' ) ) {
				$coupon->set_product_ids( array_filter( array_map( 'absint', (array) $request->get_param( 'product_ids' ) ) ) );
			}
			if ( null !== $request->get_param( 'email_restrictions' ) ) {
				$coupon->set_email_restrictions( array_filter( array_map( 'sanitize_email', array_map( 'strval', (array) $request->get_param( 'email_restrictions' ) ) ) ) );
			}

			$coupon->save();
		} catch ( Exception $e ) {
			return new WP_Error( 'diba_bridge_wc_invalid', wp_strip_all_tags( $e->getMessage() ), array( 'status' => 400 ) );
		}

		$response = rest_ensure_response(
			array(
				'ok'     => true,
				'coupon' => self::format_coupon( new WC_Coupon( $coupon->get_id() ) ),
			)
		);
		$response->set_status( 201 );
		return $response;
	}

	// ------------------------------------------------------------------
	// Reports
	// ------------------------------------------------------------------

	/**
	 * GET /wc/reports/sales — summary for a date range (default: last 30 days).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function sales_report( $request ) {
		$to   = (string) $request->get_param( 'to' );
		$from = (string) $request->get_param( 'from' );
		if ( '' === $to ) {
			$to = wp_date( 'Y-m-d' );
		}
		if ( '' === $from ) {
			$from = wp_date( 'Y-m-d', strtotime( $to . ' 00:00:00' ) - ( 29 * DAY_IN_SECONDS ) );
		}
		if ( strcmp( $from, $to ) > 0 ) {
			return new WP_Error( 'diba_bridge_wc_invalid', __( 'تاریخ شروع باید قبل از تاریخ پایان باشد.', 'diba-bridge-connector' ), array( 'status' => 400 ) );
		}

		$range     = $from . '...' . $to;
		$paid      = array( 'completed', 'processing', 'on-hold' );
		$totals    = array(
			'gross'    => 0.0,
			'refunded' => 0.0,
			'shipping' => 0.0,
			'tax'      => 0.0,
			'discount' => 0.0,
		);
		$orders_n  = 0;
		$items_n   = 0;
		$by_status = array();
		$page      = 1;
		$batch     = 200;
		$max_pages = 25;
		$truncated = false;

		do {
			$orders = wc_get_orders(
				array(
					'type'         => 'shop_order',
					'status'       => $paid,
					'date_created' => $range,
					'limit'        => $batch,
					'page'         => $page,
					'orderby'      => 'date',
					'order'        => 'ASC',
				)
			);

			foreach ( (array) $orders as $order ) {
				if ( ! $order instanceof WC_Order ) {
					continue;
				}
				++$orders_n;
				$items_n            += (int) $order->get_item_count();
				$totals['gross']    += (float) $order->get_total();
				$totals['refunded'] += (float) $order->get_total_refunded();
				$totals['shipping'] += (float) $order->get_shipping_total();
				$totals['tax']      += (float) $order->get_total_tax();
				$totals['discount'] += (float) $order->get_discount_total();

				$status               = $order->get_status();
				$by_status[ $status ] = isset( $by_status[ $status ] ) ? $by_status[ $status ] + 1 : 1;
			}

			$count = count( (array) $orders );
			++$page;
			if ( $count === $batch && $page > $max_pages ) {
				$truncated = true;
			}
		} while ( $count === $batch && $page <= $max_pages );

		foreach ( array( 'pending', 'cancelled', 'refunded', 'failed' ) as $status ) {
			$result = wc_get_orders(
				array(
					'type'         => 'shop_order',
					'status'       => array( $status ),
					'date_created' => $range,
					'limit'        => 1,
					'paginate'     => true,
					'return'       => 'ids',
				)
			);
			$by_status[ $status ] = (int) $result->total;
		}

		$decimals = wc_get_price_decimals();
		$net      = $totals['gross'] - $totals['refunded'] - $totals['shipping'] - $totals['tax'];

		return rest_ensure_response(
			array(
				'from'             => $from,
				'to'               => $to,
				'currency'         => get_woocommerce_currency(),
				'orders_count'     => $orders_n,
				'items_sold'       => $items_n,
				'gross_sales'      => wc_format_decimal( $totals['gross'], $decimals ),
				'refunds'          => wc_format_decimal( $totals['refunded'], $decimals ),
				'shipping'         => wc_format_decimal( $totals['shipping'], $decimals ),
				'tax'              => wc_format_decimal( $totals['tax'], $decimals ),
				'discounts'        => wc_format_decimal( $totals['discount'], $decimals ),
				'net_sales'        => wc_format_decimal( $net, $decimals ),
				'average_order'    => wc_format_decimal( $orders_n > 0 ? $totals['gross'] / $orders_n : 0, $decimals ),
				'counted_statuses' => $paid,
				'orders_by_status' => $by_status,
				'truncated'        => $truncated,
			)
		);
	}
}
