<?php
/**
 * Settings page (Settings → Diba Bridge).
 *
 * @package DibaBridgeConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin UI: API key, acting user, scopes, restrictions and the audit log.
 */
class Diba_Bridge_Admin {

	const PAGE       = 'diba-bridge-connector';
	const CAPABILITY = 'manage_options';

	/**
	 * Newly generated key, shown once in the same request and never stored.
	 *
	 * @var string
	 */
	private static $new_key = '';

	/**
	 * Notices for the current request.
	 *
	 * @var array<int,array{type:string,text:string}>
	 */
	private static $notices = array();

	/**
	 * Hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
	}

	/**
	 * Register the settings page.
	 *
	 * @return void
	 */
	public static function menu() {
		add_options_page(
			__( 'Diba Bridge', 'diba-bridge-connector' ),
			__( 'Diba Bridge', 'diba-bridge-connector' ),
			self::CAPABILITY,
			self::PAGE,
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * Queue a notice.
	 *
	 * @param string $type success|error|warning.
	 * @param string $text Message.
	 * @return void
	 */
	private static function notice( $type, $text ) {
		self::$notices[] = array(
			'type' => $type,
			'text' => $text,
		);
	}

	/**
	 * Split a textarea into trimmed non-empty lines.
	 *
	 * @param string $raw Raw textarea value.
	 * @return string[]
	 */
	private static function lines( $raw ) {
		$parts = preg_split( '/[\r\n,]+/', (string) $raw );
		return array_values( array_filter( array_map( 'trim', (array) $parts ) ) );
	}

	/**
	 * Handle the forms of this page. Every action needs the capability and its own nonce.
	 *
	 * @return void
	 */
	private static function handle_post() {
		if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'POST' !== $_SERVER['REQUEST_METHOD'] || empty( $_POST['diba_bridge_action'] ) ) {
			return;
		}
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return;
		}

		$action = sanitize_key( wp_unslash( $_POST['diba_bridge_action'] ) );
		check_admin_referer( 'diba_bridge_' . $action, 'diba_bridge_nonce' );

		switch ( $action ) {
			case 'generate_key':
				self::$new_key = Diba_Bridge_Settings::generate_key();
				$settings      = Diba_Bridge_Settings::get();
				if ( ! $settings['user_id'] ) {
					Diba_Bridge_Settings::update( array( 'user_id' => get_current_user_id() ) );
				}
				self::notice( 'success', __( 'کلید جدید ساخته شد. همین حالا آن را کپی کنید؛ دیگر نمایش داده نمی‌شود.', 'diba-bridge-connector' ) );
				break;

			case 'revoke_key':
				Diba_Bridge_Settings::revoke_key();
				self::notice( 'success', __( 'کلید باطل شد. تا ساختن کلید جدید هیچ درخواستی پذیرفته نمی‌شود.', 'diba-bridge-connector' ) );
				break;

			case 'clear_log':
				Diba_Bridge_Audit_Log::clear();
				self::notice( 'success', __( 'گزارش فعالیت پاک شد.', 'diba-bridge-connector' ) );
				break;

			case 'save_settings':
				self::save_settings();
				break;
		}
	}

	/**
	 * Save the settings form. The nonce was verified in handle_post().
	 *
	 * @return void
	 */
	private static function save_settings() {
		// phpcs:disable WordPress.Security.NonceVerification.Missing
		$user_id = isset( $_POST['diba_bridge_user_id'] ) ? absint( wp_unslash( $_POST['diba_bridge_user_id'] ) ) : 0;
		if ( $user_id && ! get_userdata( $user_id ) ) {
			$user_id = 0;
		}

		$scopes = array();
		if ( isset( $_POST['diba_bridge_scopes'] ) && is_array( $_POST['diba_bridge_scopes'] ) ) {
			$scopes = array_map( 'sanitize_key', wp_unslash( $_POST['diba_bridge_scopes'] ) );
		}
		$scopes = array_values( array_intersect( array_keys( Diba_Bridge_Settings::scopes() ), $scopes ) );

		$ip_raw   = isset( $_POST['diba_bridge_ip_allowlist'] ) ? sanitize_textarea_field( wp_unslash( $_POST['diba_bridge_ip_allowlist'] ) ) : '';
		$ip_lines = self::lines( $ip_raw );
		$ip_rules = Diba_Bridge_Auth::sanitize_ip_rules( $ip_lines );
		if ( count( $ip_rules ) !== count( array_unique( $ip_lines ) ) ) {
			self::notice( 'warning', __( 'بعضی از نشانی‌های IP نامعتبر بودند و نادیده گرفته شدند.', 'diba-bridge-connector' ) );
		}

		$options_raw = isset( $_POST['diba_bridge_allowed_options'] ) ? sanitize_textarea_field( wp_unslash( $_POST['diba_bridge_allowed_options'] ) ) : '';
		$options     = array();
		$refused     = array();
		foreach ( self::lines( $options_raw ) as $name ) {
			if ( ! preg_match( '/^[A-Za-z0-9_\-:.]{1,190}$/', $name ) || Diba_Bridge_Tools::option_denied( $name ) ) {
				$refused[] = $name;
				continue;
			}
			$options[] = $name;
		}
		if ( ! empty( $refused ) ) {
			self::notice(
				'warning',
				sprintf(
					/* translators: %s: comma separated option names */
					__( 'این گزینه‌ها حساس یا نامعتبرند و به فهرست مجاز اضافه نشدند: %s', 'diba-bridge-connector' ),
					implode( '، ', $refused )
				)
			);
		}

		Diba_Bridge_Settings::update(
			array(
				'user_id'         => $user_id,
				'scopes'          => $scopes,
				'read_only'       => ! empty( $_POST['diba_bridge_read_only'] ),
				'allow_http'      => ! empty( $_POST['diba_bridge_allow_http'] ),
				'ip_allowlist'    => $ip_rules,
				'rate_limit'      => isset( $_POST['diba_bridge_rate_limit'] ) ? absint( wp_unslash( $_POST['diba_bridge_rate_limit'] ) ) : 120,
				'log_retention'   => isset( $_POST['diba_bridge_log_retention'] ) ? absint( wp_unslash( $_POST['diba_bridge_log_retention'] ) ) : 30,
				'allowed_options' => array_values( array_unique( $options ) ),
			)
		);
		// phpcs:enable

		self::notice( 'success', __( 'تنظیمات ذخیره شد.', 'diba-bridge-connector' ) );
	}

	/**
	 * Render the page.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'شما اجازه‌ی دیدن این صفحه را ندارید.', 'diba-bridge-connector' ) );
		}

		self::handle_post();

		$settings = Diba_Bridge_Settings::get();
		$has_key  = Diba_Bridge_Settings::has_key();
		$user     = $settings['user_id'] ? get_userdata( $settings['user_id'] ) : false;
		$page_url = admin_url( 'options-general.php?page=' . self::PAGE );
		?>
		<div class="wrap">
			<h1><?php echo esc_html__( 'Diba Bridge Connector', 'diba-bridge-connector' ); ?></h1>
			<p>
				<?php echo esc_html__( 'این افزونه سایت شما را به‌صورت امن به «دیباپل» (Diba Bridge) وصل می‌کند. هر درخواست با کلید زیر احراز هویت می‌شود و با دسترسی‌های همان کاربری که انتخاب می‌کنید اجرا می‌شود.', 'diba-bridge-connector' ); ?>
			</p>

			<?php foreach ( self::$notices as $notice ) : ?>
				<div class="notice notice-<?php echo esc_attr( $notice['type'] ); ?> is-dismissible"><p><?php echo esc_html( $notice['text'] ); ?></p></div>
			<?php endforeach; ?>

			<?php if ( ! is_ssl() && ! $settings['allow_http'] ) : ?>
				<div class="notice notice-warning"><p><?php echo esc_html__( 'این سایت روی HTTPS نیست؛ تا وقتی HTTPS فعال نشود (یا HTTP را برای توسعه‌ی محلی مجاز نکنید) درخواست‌ها رد می‌شوند.', 'diba-bridge-connector' ); ?></p></div>
			<?php endif; ?>

			<?php if ( $has_key && ! $user ) : ?>
				<div class="notice notice-error"><p><?php echo esc_html__( 'کاربر اجرای درخواست‌ها انتخاب نشده است؛ تا انتخاب آن، درخواست‌ها رد می‌شوند.', 'diba-bridge-connector' ); ?></p></div>
			<?php endif; ?>

			<h2><?php echo esc_html__( 'کلید اتصال', 'diba-bridge-connector' ); ?></h2>

			<?php if ( '' !== self::$new_key ) : ?>
				<div class="notice notice-info inline">
					<p><strong><?php echo esc_html__( 'کلید جدید شما (فقط همین یک بار نمایش داده می‌شود):', 'diba-bridge-connector' ); ?></strong></p>
					<p><input type="text" class="large-text code" readonly dir="ltr" onclick="this.select();" value="<?php echo esc_attr( self::$new_key ); ?>" /></p>
					<p><?php echo esc_html__( 'این کلید را در دیباپل در فیلد «کلید افزونه» (یا متغیر WORDPRESS_CONNECTOR_KEY) وارد کنید. فقط هش کلید در پایگاه‌داده نگه‌داری می‌شود.', 'diba-bridge-connector' ); ?></p>
				</div>
			<?php endif; ?>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php echo esc_html__( 'وضعیت', 'diba-bridge-connector' ); ?></th>
					<td>
						<?php if ( $has_key ) : ?>
							<span dir="ltr"><code><?php echo esc_html( $settings['key_prefix'] ); ?>…</code></span>
							—
							<?php
							printf(
								/* translators: %s: date */
								esc_html__( 'ساخته‌شده در %s', 'diba-bridge-connector' ),
								esc_html( wp_date( get_option( 'date_format' ) . ' H:i', (int) $settings['key_created'] ) )
							);
							?>
						<?php else : ?>
							<?php echo esc_html__( 'هنوز کلیدی ساخته نشده است.', 'diba-bridge-connector' ); ?>
						<?php endif; ?>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php echo esc_html__( 'نشانی API', 'diba-bridge-connector' ); ?></th>
					<td><code dir="ltr"><?php echo esc_html( rest_url( DIBA_BRIDGE_REST_NAMESPACE ) ); ?></code></td>
				</tr>
			</table>

			<form method="post" action="<?php echo esc_url( $page_url ); ?>" style="display:inline-block;margin-inline-end:8px;">
				<?php wp_nonce_field( 'diba_bridge_generate_key', 'diba_bridge_nonce' ); ?>
				<input type="hidden" name="diba_bridge_action" value="generate_key" />
				<?php
				submit_button(
					$has_key ? __( 'ساخت کلید جدید (کلید قبلی باطل می‌شود)', 'diba-bridge-connector' ) : __( 'ساخت کلید', 'diba-bridge-connector' ),
					'primary',
					'submit',
					false
				);
				?>
			</form>

			<?php if ( $has_key ) : ?>
				<form method="post" action="<?php echo esc_url( $page_url ); ?>" style="display:inline-block;">
					<?php wp_nonce_field( 'diba_bridge_revoke_key', 'diba_bridge_nonce' ); ?>
					<input type="hidden" name="diba_bridge_action" value="revoke_key" />
					<?php submit_button( __( 'باطل کردن کلید', 'diba-bridge-connector' ), 'delete', 'submit', false ); ?>
				</form>
			<?php endif; ?>

			<hr />

			<h2><?php echo esc_html__( 'تنظیمات دسترسی', 'diba-bridge-connector' ); ?></h2>
			<form method="post" action="<?php echo esc_url( $page_url ); ?>">
				<?php wp_nonce_field( 'diba_bridge_save_settings', 'diba_bridge_nonce' ); ?>
				<input type="hidden" name="diba_bridge_action" value="save_settings" />

				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="diba_bridge_user_id"><?php echo esc_html__( 'کاربر اجرای درخواست‌ها', 'diba-bridge-connector' ); ?></label></th>
						<td>
							<?php
							wp_dropdown_users(
								array(
									'name'             => 'diba_bridge_user_id',
									'id'               => 'diba_bridge_user_id',
									'selected'         => (int) $settings['user_id'],
									'show_option_none' => __( '— انتخاب کنید —', 'diba-bridge-connector' ),
									'option_none_value' => 0,
									'role__in'         => array( 'administrator', 'editor', 'author', 'shop_manager' ),
									'show'             => 'display_name_with_login',
								)
							);
							?>
							<p class="description"><?php echo esc_html__( 'همه‌ی درخواست‌ها با نقش و توانایی‌های همین کاربر بررسی می‌شوند؛ کلید هیچ‌وقت از دسترسی‌های این کاربر فراتر نمی‌رود. برای محدود کردن، یک کاربر با نقش پایین‌تر (مثلاً ویرایشگر) انتخاب کنید.', 'diba-bridge-connector' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php echo esc_html__( 'بخش‌های مجاز', 'diba-bridge-connector' ); ?></th>
						<td>
							<fieldset>
								<?php foreach ( Diba_Bridge_Settings::scopes() as $slug => $label ) : ?>
									<label>
										<input type="checkbox" name="diba_bridge_scopes[]" value="<?php echo esc_attr( $slug ); ?>" <?php checked( in_array( $slug, $settings['scopes'], true ) ); ?> />
										<?php echo esc_html( $label ); ?>
									</label><br />
								<?php endforeach; ?>
							</fieldset>
							<p class="description"><?php echo esc_html__( 'فقط بخش‌هایی را که واقعاً لازم دارید روشن کنید.', 'diba-bridge-connector' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php echo esc_html__( 'حالت فقط‌خواندنی', 'diba-bridge-connector' ); ?></th>
						<td>
							<label>
								<input type="checkbox" name="diba_bridge_read_only" value="1" <?php checked( $settings['read_only'] ); ?> />
								<?php echo esc_html__( 'هیچ تغییری در سایت پذیرفته نشود (فقط خواندن اطلاعات)', 'diba-bridge-connector' ); ?>
							</label>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="diba_bridge_ip_allowlist"><?php echo esc_html__( 'نشانی‌های IP مجاز', 'diba-bridge-connector' ); ?></label></th>
						<td>
							<textarea name="diba_bridge_ip_allowlist" id="diba_bridge_ip_allowlist" rows="3" class="large-text code" dir="ltr"><?php echo esc_textarea( implode( "\n", $settings['ip_allowlist'] ) ); ?></textarea>
							<p class="description"><?php echo esc_html__( 'هر خط یک IP یا بازه‌ی CIDR (مثلاً 203.0.113.10 یا 203.0.113.0/24). خالی = همه‌ی نشانی‌ها.', 'diba-bridge-connector' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="diba_bridge_rate_limit"><?php echo esc_html__( 'سقف درخواست در دقیقه', 'diba-bridge-connector' ); ?></label></th>
						<td><input type="number" min="10" max="6000" name="diba_bridge_rate_limit" id="diba_bridge_rate_limit" value="<?php echo esc_attr( (string) $settings['rate_limit'] ); ?>" class="small-text" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="diba_bridge_log_retention"><?php echo esc_html__( 'نگه‌داری گزارش فعالیت (روز)', 'diba-bridge-connector' ); ?></label></th>
						<td><input type="number" min="1" max="365" name="diba_bridge_log_retention" id="diba_bridge_log_retention" value="<?php echo esc_attr( (string) $settings['log_retention'] ); ?>" class="small-text" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="diba_bridge_allowed_options"><?php echo esc_html__( 'گزینه‌های مجاز اضافه', 'diba-bridge-connector' ); ?></label></th>
						<td>
							<textarea name="diba_bridge_allowed_options" id="diba_bridge_allowed_options" rows="3" class="large-text code" dir="ltr"><?php echo esc_textarea( implode( "\n", $settings['allowed_options'] ) ); ?></textarea>
							<p class="description"><?php echo esc_html__( 'نام گزینه‌های wp_options که علاوه بر فهرست پیش‌فرض قابل خواندن و تغییر باشند (هر خط یک نام). گزینه‌های حساس مثل کلیدها، رمزها و فهرست افزونه‌های فعال هرگز پذیرفته نمی‌شوند.', 'diba-bridge-connector' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php echo esc_html__( 'اتصال بدون HTTPS', 'diba-bridge-connector' ); ?></th>
						<td>
							<label>
								<input type="checkbox" name="diba_bridge_allow_http" value="1" <?php checked( $settings['allow_http'] ); ?> />
								<?php echo esc_html__( 'اجازه‌ی اتصال روی HTTP (فقط برای توسعه‌ی محلی؛ روی سایت واقعی روشن نکنید)', 'diba-bridge-connector' ); ?>
							</label>
						</td>
					</tr>
				</table>

				<?php submit_button( __( 'ذخیره‌ی تنظیمات', 'diba-bridge-connector' ) ); ?>
			</form>

			<hr />

			<h2><?php echo esc_html__( 'گزارش فعالیت', 'diba-bridge-connector' ); ?></h2>
			<?php self::render_log( $page_url ); ?>
		</div>
		<?php
	}

	/**
	 * Render the audit log table.
	 *
	 * @param string $page_url Page URL.
	 * @return void
	 */
	private static function render_log( $page_url ) {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only pagination parameter.
		$page     = isset( $_GET['log_page'] ) ? max( 1, absint( wp_unslash( $_GET['log_page'] ) ) ) : 1;
		$per_page = 50;
		$result   = Diba_Bridge_Audit_Log::query(
			array(
				'page'     => $page,
				'per_page' => $per_page,
			)
		);
		$pages    = (int) ceil( $result['total'] / $per_page );

		if ( empty( $result['items'] ) ) {
			echo '<p>' . esc_html__( 'هنوز فعالیتی ثبت نشده است.', 'diba-bridge-connector' ) . '</p>';
			return;
		}
		?>
		<table class="widefat striped">
			<thead>
				<tr>
					<th><?php echo esc_html__( 'زمان (UTC)', 'diba-bridge-connector' ); ?></th>
					<th><?php echo esc_html__( 'روش', 'diba-bridge-connector' ); ?></th>
					<th><?php echo esc_html__( 'مسیر', 'diba-bridge-connector' ); ?></th>
					<th><?php echo esc_html__( 'وضعیت', 'diba-bridge-connector' ); ?></th>
					<th><?php echo esc_html__( 'کاربر', 'diba-bridge-connector' ); ?></th>
					<th><?php echo esc_html__( 'IP', 'diba-bridge-connector' ); ?></th>
					<th><?php echo esc_html__( 'جزئیات', 'diba-bridge-connector' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $result['items'] as $row ) : ?>
					<tr>
						<td dir="ltr"><?php echo esc_html( $row['time'] ); ?></td>
						<td dir="ltr"><?php echo esc_html( $row['method'] ); ?></td>
						<td dir="ltr"><code><?php echo esc_html( $row['route'] ); ?></code></td>
						<td dir="ltr"><?php echo esc_html( (string) $row['status'] ); ?></td>
						<td><?php echo esc_html( $row['user_id'] ? (string) $row['user_id'] : '—' ); ?></td>
						<td dir="ltr"><?php echo esc_html( $row['ip'] ); ?></td>
						<td dir="ltr"><?php echo esc_html( $row['details'] ); ?></td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>

		<p>
			<?php if ( $page > 1 ) : ?>
				<a class="button" href="<?php echo esc_url( add_query_arg( 'log_page', $page - 1, $page_url ) ); ?>"><?php echo esc_html__( 'جدیدتر', 'diba-bridge-connector' ); ?></a>
			<?php endif; ?>
			<?php if ( $page < $pages ) : ?>
				<a class="button" href="<?php echo esc_url( add_query_arg( 'log_page', $page + 1, $page_url ) ); ?>"><?php echo esc_html__( 'قدیمی‌تر', 'diba-bridge-connector' ); ?></a>
			<?php endif; ?>
			<?php
			printf(
				/* translators: 1: current page, 2: total pages, 3: total rows */
				esc_html__( 'صفحه‌ی %1$d از %2$d — %3$d مورد', 'diba-bridge-connector' ),
				(int) $page,
				(int) max( 1, $pages ),
				(int) $result['total']
			);
			?>
		</p>

		<form method="post" action="<?php echo esc_url( $page_url ); ?>">
			<?php wp_nonce_field( 'diba_bridge_clear_log', 'diba_bridge_nonce' ); ?>
			<input type="hidden" name="diba_bridge_action" value="clear_log" />
			<?php submit_button( __( 'پاک کردن گزارش', 'diba-bridge-connector' ), 'secondary', 'submit', false ); ?>
		</form>
		<?php
	}
}
