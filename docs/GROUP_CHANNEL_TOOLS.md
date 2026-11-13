# Group & channel management tools

## Bale user account (`bale_client`)

Added:

- `bale_client_list_groups`
- `bale_client_list_channels`
- `bale_client_get_chat_members`
- `bale_client_add_chat_members`
- `bale_client_edit_chat` — title / description (groups)
- `bale_client_leave_chat`
- `bale_client_get_chat_link`
- `bale_client_join_chat`

The underlying Bale client library does not expose group/channel creation or deletion, so those operations are not included.

## Eitaa user account (`eitaa_client`, via EitaaBun)

Added:

- `eitaa_client_list_groups`
- `eitaa_client_list_channels`
- `eitaa_client_create_group`
- `eitaa_client_get_chat_members`
- `eitaa_client_add_chat_member`
- `eitaa_client_remove_chat_member`
- `eitaa_client_edit_chat` — title / description
- `eitaa_client_leave_chat`
- `eitaa_client_delete_chat`
- `eitaa_client_get_chat_link`

EitaaBun exposes group creation but no separate channel-creation route. Existing channels can still be listed, edited, left, deleted, and have their invite link fetched.

## Telegram user account (`telegram_client`, MTProto)

Added:

- `telegram_client_list_groups`
- `telegram_client_list_channels`
- `telegram_client_create_group`
- `telegram_client_create_channel`
- `telegram_client_chat_members`
- `telegram_client_add_chat_members`
- `telegram_client_edit_chat`
- `telegram_client_leave_chat`
- `telegram_client_delete_chat`
- `telegram_client_get_chat_link`

Connect with a phone number and code in the dashboard. The session is stored as a `StringSession` on the server. Default public API credentials are included for convenience; you can replace them with your own from `my.telegram.org`.

## Telegram user account (`telegram_client`, MTProto)

Added:

- `telegram_client_get_chat_member_count`
- `telegram_client_get_chat_administrators`
- `telegram_client_get_chat_member`
- `telegram_client_set_chat_title`
- `telegram_client_set_chat_description`
- `telegram_client_leave_chat`
- `telegram_client_ban_chat_member`
- `telegram_client_unban_chat_member`
- `telegram_client_pin_chat_message`
- `telegram_client_unpin_chat_message`

These require the connected account to be an administrator/owner with the relevant permission.

## Permissions

Most write operations require the connected account to be an administrator/owner of the target group or channel. Errors are returned with the provider’s original message when the operation is not permitted.
