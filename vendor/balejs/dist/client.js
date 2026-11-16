"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const promises_2 = require("node:readline/promises");
const node_process_1 = require("node:process");
const conditions_1 = require("./conditions");
const dispatcher_1 = require("./core/dispatcher");
const grpc_1 = require("./core/grpc");
const ws_1 = require("./core/ws");
const errors_1 = require("./errors");
const objects_1 = require("./objects");
const EMPTY_PAGE_NO = Buffer.alloc(0);
const START_PHONE_AUTH_OPTIONS = Buffer.from([0, 1]);
const EMPTY_OPTIMIZATIONS = [];
function isSessionString(value) {
    return /^\d+:.+$/.test(value);
}
function parseSessionString(value) {
    const [userId, jwt] = value.trim().split(":", 2);
    return {
        userId: Number(userId),
        jwt,
    };
}
function formatSessionString(session) {
    return `${session.userId}:${session.jwt}`;
}
function normalizeAuthPhoneNumber(phoneNumber) {
    return Number(phoneNumber.replace(/[^\d]/g, ""));
}
function formatPhoneNumberInputHint(phoneNumber) {
    const normalized = phoneNumber.replace(/[^\d]/g, "");
    return normalized ? `Received "${phoneNumber}" -> "${normalized}".` : `Received "${phoneNumber}".`;
}
function normalizeSearchQuery(value) {
    if (value.startsWith("@")) {
        return value.slice(1);
    }
    if (value.startsWith("+")) {
        return value.slice(1);
    }
    if (value.startsWith("https://ble.ir/")) {
        return value.slice("https://ble.ir/".length);
    }
    if (value.startsWith("ble.ir/")) {
        return value.slice("ble.ir/".length);
    }
    return value;
}
function extractJoinToken(value) {
    if (value.startsWith("https://ble.ir/join/")) {
        return value.slice("https://ble.ir/join/".length);
    }
    if (value.startsWith("ble.ir/join/")) {
        return value.slice("ble.ir/join/".length);
    }
    return value;
}
function parsePeerString(value) {
    const match = /^(\d+)\|(\d+)$/.exec(value.trim());
    if (!match) {
        return undefined;
    }
    return {
        id: Number(match[1]),
        type: Number(match[2]),
    };
}
function parseMessageId(value) {
    const match = /^(\d+)\|(\d+)$/.exec(value.trim());
    if (!match) {
        throw new TypeError(`Invalid Bale message id: ${value}`);
    }
    return {
        rid: Number(match[1]),
        date: Number(match[2]),
    };
}
class Client {
    token_or_phone_number;
    sessionDir;
    dispatcher = new dispatcher_1.Dispatcher();
    grpcConnection;
    websocketOptions;
    websocket;
    session;
    running = false;
    stopPromise;
    stopResolver;
    shutdownDispatched = false;
    peerCache = new Map();
    inflightPeerLoads = new Map();
    inflightChatSearches = new Map();
    messageChatCache = new Map();
    messageAuthorCache = new Map();
    walletCache;
    walletCachePromise;
    user;
    constructor(tokenOrPhoneNumber, options = {}) {
        this.token_or_phone_number = tokenOrPhoneNumber;
        this.sessionDir = options.sessionDir ?? process.cwd();
        this.grpcConnection = new grpc_1.BaleGrpcConnection(options.grpc);
        this.websocketOptions = options.websocket ?? {};
        if (isSessionString(tokenOrPhoneNumber)) {
            this.session = parseSessionString(tokenOrPhoneNumber);
        }
    }
    on_message(conditionOrCallback) {
        if (typeof conditionOrCallback === "function") {
            return this.dispatcher.addMessageHandler(conditionOrCallback);
        }
        return (callback) => this.dispatcher.addMessageHandler(callback, conditionOrCallback);
    }
    on_command(name, condition) {
        return (callback) => {
            const commandCondition = (0, conditions_1.command)(name);
            const finalCondition = condition ? commandCondition.and(condition) : commandCondition;
            return this.dispatcher.addMessageHandler(callback, finalCondition);
        };
    }
    on_error(callback) {
        return this.dispatcher.addErrorHandler(callback);
    }
    on_connect(callback) {
        return this.dispatcher.addLifecycleHandler("connect", callback);
    }
    on_disconnect(callback) {
        return this.dispatcher.addLifecycleHandler("disconnect", callback);
    }
    on_initialize(callback) {
        return this.dispatcher.addLifecycleHandler("initialize", callback);
    }
    on_shutdown(callback) {
        return this.dispatcher.addLifecycleHandler("shutdown", callback);
    }
    async connect() {
        if (!this.session) {
            this.session = await this.load_session();
        }
        if (!this.session) {
            this.session = await this.authenticate();
            await this.save_session(this.session);
        }
        this.websocket = new ws_1.BaleWebSocketConnection(this.session.jwt, this.websocketOptions);
        this.websocket.on("update", (update) => {
            void this.handleUpdate(update);
        });
        this.websocket.on("close", () => {
            void this.handleDisconnect();
        });
        this.websocket.on("error", (error) => {
            void this.dispatcher.dispatchError(this, error);
        });
        await this.websocket.start();
        this.user = await this.get_me();
    }
    async disconnect() {
        if (this.websocket) {
            await this.websocket.stop();
            this.websocket = undefined;
        }
        this.grpcConnection.close();
    }
    run(task) {
        return (async () => {
            const sigintHandler = () => {
                void this.stop();
            };
            process.once("SIGINT", sigintHandler);
            try {
                await this.connect();
                this.running = true;
                this.shutdownDispatched = false;
                this.stopPromise = new Promise((resolve) => {
                    this.stopResolver = resolve;
                });
                await this.dispatcher.dispatchLifecycle("connect", this);
                await this.dispatcher.dispatchLifecycle("initialize", this);
                if (task) {
                    await task(this);
                    await this.stop();
                }
                else if (this.stopPromise) {
                    await this.stopPromise;
                }
            }
            catch (error) {
                await this.dispatcher.dispatchError(this, error);
            }
            finally {
                process.removeListener("SIGINT", sigintHandler);
                await this.stop();
            }
        })();
    }
    async stop() {
        if (!this.running && !this.websocket) {
            return;
        }
        this.running = false;
        if (!this.shutdownDispatched) {
            this.shutdownDispatched = true;
            await this.dispatcher.dispatchLifecycle("shutdown", this);
        }
        await this.disconnect();
        if (this.stopResolver) {
            this.stopResolver();
            this.stopResolver = undefined;
        }
    }
    async start_phone_auth(phoneNumber) {
        return await this.grpcConnection.request("bale.auth.v1.Auth/StartPhoneAuth", "request.StartPhoneAuth", "response.StartPhoneAuth", {
            phone_number: normalizeAuthPhoneNumber(phoneNumber),
            app_id: 4,
            api_key: "C28D46DC4C3A7A26564BFCC48B929086A95C93C98E789A19847BEE8627DE4E7D",
            device_hash: "ce5ced83-a9ab-47fa-80c8-ed425eeb2ace",
            device_title: "Chrome_138.0.0.0, Windows",
            send_code_type: 1,
            options: START_PHONE_AUTH_OPTIONS,
        });
    }
    async validate_code(transactionHash, code) {
        return await this.grpcConnection.request("bale.auth.v1.Auth/ValidateCode", "request.ValidateCode", "response.Auth", {
            transaction_hash: transactionHash,
            code,
            is_jwt: {
                value: true,
            },
        });
    }
    async validate_password(transactionHash, password) {
        return await this.grpcConnection.request("bale.auth.v1.Auth/ValidatePassword", "request.ValidatePassword", "response.Auth", {
            transaction_hash: transactionHash,
            password,
            is_jwt: {
                value: true,
            },
        });
    }
    async sign_up(transactionHash, name, password) {
        return await this.grpcConnection.request("bale.auth.v1.Auth/SignUp", "request.SignUp", "response.Auth", {
            transaction_hash: transactionHash,
            name,
            password: password ? { value: password } : undefined,
        });
    }
    async get_me() {
        const session = this.session ?? (await this.load_session());
        if (!session) {
            throw new errors_1.AuthenticationError("No Bale session is available");
        }
        const me = await this.get_chat(`${session.userId}|1`);
        if (!(me instanceof objects_1.User)) {
            throw new errors_1.ClientStateError("Could not load Bale user profile");
        }
        me.bind(this);
        return me;
    }
    async get_chat(chatId) {
        const cachedPeer = this.peerCache.get(chatId);
        if (cachedPeer) {
            return cachedPeer;
        }
        const parsed = parsePeerString(chatId);
        if (parsed) {
            return await this.loadPeer(parsed.id, parsed.type);
        }
        const normalizedQuery = normalizeSearchQuery(chatId);
        const inflightSearch = this.inflightChatSearches.get(normalizedQuery);
        if (inflightSearch) {
            return await inflightSearch;
        }
        const searchPromise = this.searchChat(normalizedQuery);
        this.inflightChatSearches.set(normalizedQuery, searchPromise);
        try {
            return await searchPromise;
        }
        finally {
            this.inflightChatSearches.delete(normalizedQuery);
        }
    }
    async searchChat(normalizedQuery) {
        const response = await this.invoke("bale.users.v1.Users", "SearchContacts", "request.SearchContacts", "response.SearchContacts", {
            request: normalizedQuery,
        });
        if (response.user_peers?.length) {
            return await this.loadPeer(Number(response.user_peers[0].uid), 1);
        }
        if (response.group_peers?.length) {
            return await this.loadPeer(Number(response.group_peers[0].group_id), 2);
        }
        return undefined;
    }
    async load_history(chatId, fromDate = -1, limit = 20) {
        const peer = this.requirePeer(chatId);
        const history = await this.loadHistory(peer, fromDate, limit);
        const messages = Array.isArray(history.history) ? history.history : [];
        return messages
            .map((item) => {
            return this.wrapIncomingMessage({
                peer,
                sender_uid: item.sender_uid,
                date: item.date,
                rid: item.rid,
                message: item.message,
            });
        })
            .filter((message) => Number(message.rid) !== 0);
    }
    async load_dialogs(limit = 40, minDate = -1, excludePinned = false) {
        return await this.invoke("bale.messaging.v2.Messaging", "LoadDialogs", "request.LoadDialogs", "response.LoadDialogs", {
            min_date: minDate,
            limit,
            exclude_pinned_dialogs: excludePinned,
        });
    }
    async set_online(isOnline, duration) {
        const response = await this.invoke("bale.presence.v1.Presence", "SetOnline", "request.SetOnline", "response.DefaultResponse", {
            is_online: isOnline ? 1 : 0,
            duration,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async start_typing(chatId, typingType = 1) {
        const peer = this.requireOutPeer(chatId);
        const response = await this.invoke("bale.presence.v1.Presence", "Typing", "request.Typing", "response.DefaultResponse", {
            peer,
            typing_type: typingType,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async stop_typing(chatId, typingType = 1) {
        const peer = this.requirePeer(chatId);
        const response = await this.invoke("bale.presence.v1.Presence", "StopTyping", "request.StopTyping", "response.DefaultResponse", {
            peer,
            typing_type: typingType,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async join_chat(tokenOrUrl) {
        const response = await this.invoke("bale.groups.v1.Groups", "JoinGroup", "request.JoinGroup", "response.JoinGroup", {
            token: extractJoinToken(tokenOrUrl),
            optimizations: EMPTY_OPTIMIZATIONS,
        });
        const chat = (0, objects_1.wrapGroup)(response.group);
        chat.bind(this);
        this.peerCache.set(`${chat.peerId}|${chat.peerType}`, chat);
        return chat;
    }
    async join_public_chat(chatId) {
        const peer = this.requirePeer(chatId);
        const response = await this.invoke("bale.groups.v1.Groups", "JoinPublicGroup", "request.JoinPublicGroup", "response.JoinPublicGroup", {
            peer,
            optimizations: EMPTY_OPTIMIZATIONS,
        });
        const chat = (0, objects_1.wrapGroup)(response.group);
        chat.bind(this);
        this.peerCache.set(`${chat.peerId}|${chat.peerType}`, chat);
        return chat;
    }
    async leave_chat(chatId) {
        const groupPeer = this.requireGroupPeer(chatId);
        const response = await this.invoke("bale.groups.v1.Groups", "LeaveGroup", "request.LeaveGroup", "response.DefaultResponse", {
            group_peer: groupPeer,
            rid: ws_1.BaleWebSocketConnection.createRid(),
            optimizations: EMPTY_OPTIMIZATIONS,
            make_orphan: false,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async get_group_link(chatId) {
        const groupPeer = this.requireGroupPeer(chatId);
        const response = await this.invoke("bale.groups.v1.Groups", "GetGroupInviteURL", "request.GetGroupInviteUrl", "response.GetGroupInviteUrl", {
            group_peer: groupPeer,
        });
        return response.url;
    }
    async revoke_group_link(chatId) {
        const groupPeer = this.requireGroupPeer(chatId);
        const response = await this.invoke("bale.groups.v1.Groups", "RevokeInviteURL", "request.RevokeInviteUrl", "response.RevokeInviteUrl", {
            group_peer: groupPeer,
        });
        return response.url;
    }
    async invite_users(chatId, userIds) {
        const groupPeer = this.requireGroupPeer(chatId);
        return await this.invoke("bale.groups.v1.Groups", "InviteUsers", "request.InviteUsers", "response.InviteUsers", {
            group_peer: groupPeer,
            rid: ws_1.BaleWebSocketConnection.createRid(),
            users: userIds.map((id) => ({
                uid: id,
                access_hash: 1,
            })),
        });
    }
    async edit_group_title(chatId, title) {
        const groupPeer = this.requireGroupPeer(chatId);
        const response = await this.invoke("bale.groups.v1.Groups", "EditGroupTitle", "request.EditGroupTitle", "response.DefaultResponse", {
            group_peer: groupPeer,
            title,
            rid: ws_1.BaleWebSocketConnection.createRid(),
            optimizations: EMPTY_OPTIMIZATIONS,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async edit_group_about(chatId, about) {
        const groupPeer = this.requireGroupPeer(chatId);
        const response = await this.invoke("bale.groups.v1.Groups", "EditGroupAbout", "request.EditGroupAbout", "response.DefaultResponse", {
            group_peer: groupPeer,
            rid: ws_1.BaleWebSocketConnection.createRid(),
            about,
            optimizations: EMPTY_OPTIMIZATIONS,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async load_members(chatId, limit = 50, next) {
        const groupPeer = this.requireGroupPeer(chatId);
        return await this.invoke("bale.groups.v1.Groups", "LoadMembers", "request.LoadMembers", "response.LoadMembers", {
            group: groupPeer,
            limit,
            next: next !== undefined ? { value: String(next) } : undefined,
        });
    }
    async get_group_members_count(chatId) {
        const groupPeer = this.requireGroupPeer(chatId);
        const response = await this.invoke("bale.groups.v1.Groups", "GetGroupMembersCount", "request.GetGroupMembersCount", "response.GetGroupMembersCount", {
            group: groupPeer,
        });
        return Number(response.members_count ?? 0);
    }
    async load_pinned_messages(chatId) {
        const peer = this.requireExPeer(chatId);
        const response = await this.invoke("bale.messaging.v2.Messaging", "LoadPinnedMessages", "request.LoadPinnedMessages", "response.LoadPinnedMessages", {
            peer,
        });
        const items = Array.isArray(response.pinned_messages) ? response.pinned_messages : [];
        return items.map((item) => {
            return this.wrapIncomingMessage({
                peer: peer,
                sender_uid: item.sender_uid,
                date: item.date,
                rid: item.rid,
                message: item.message,
            });
        });
    }
    async pin_group_message(chatId, messageId) {
        const groupPeer = this.requireGroupPeer(chatId);
        const parsedMessageId = parseMessageId(messageId);
        const response = await this.invoke("bale.groups.v1.Groups", "PinMessage", "request.PinMessage", "response.DefaultResponse", {
            group_peer: groupPeer,
            date: parsedMessageId.date,
            msg_rid: parsedMessageId.rid,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async unpin_group_message(chatId, messageId) {
        const groupPeer = this.requireGroupPeer(chatId);
        const parsedMessageId = parseMessageId(messageId);
        const response = await this.invoke("bale.groups.v1.Groups", "RemoveSinglePin", "request.RemoveSinglePin", "response.DefaultResponse", {
            group_peer: groupPeer,
            rid: parsedMessageId.rid,
            date: parsedMessageId.date,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async remove_group_pins(chatId) {
        const groupPeer = this.requireGroupPeer(chatId);
        const response = await this.invoke("bale.groups.v1.Groups", "RemovePin", "request.RemovePin", "response.DefaultResponse", {
            group_peer: groupPeer,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async get_file(fileId, accessHash) {
        return await this.invoke("ai.bale.server.Files", "GetNasimFileUrl", "request.GetNasimFileUrl", "response.GetNasimFileUrl", {
            file: {
                file_id: fileId,
                access_hash: accessHash,
            },
        });
    }
    async get_file_upload_url(expectedSize, crc = 0, uid = this.user?.id ?? this.session?.userId ?? 0, name, mimeType, exPeer, sendType, chunkSize) {
        return await this.invoke("ai.bale.server.Files", "GetNasimFileUploadUrl", "request.GetNasimFileUploadUrl", "response.GetNasimFileUploadUrl", {
            expected_size: expectedSize,
            crc,
            uid,
            name,
            mime_type: mimeType,
            ex_peer: exPeer ? this.requireExPeer(exPeer) : undefined,
            send_type: sendType !== undefined ? { type: sendType } : undefined,
            chunk_size: chunkSize,
        });
    }
    async send_message(chatId, text) {
        const peer = this.requirePeer(chatId);
        const rid = ws_1.BaleWebSocketConnection.createRid();
        const messagePayload = {
            text_message: {
                text,
            },
        };
        const response = await this.invoke("bale.messaging.v2.Messaging", "SendMessage", "request.SendMessage", "response.DefaultResponse", {
            peer,
            rid,
            message: messagePayload,
            ex_peer: peer,
        });
        return this.createOutboundMessage(peer, rid, response.date, messagePayload);
    }
    async delete_message(chatId, messageId) {
        const peer = this.requirePeer(chatId);
        const parsedMessageId = parseMessageId(messageId);
        const response = await this.invoke("bale.messaging.v2.Messaging", "DeleteMessage", "request.DeleteMessage", "response.DefaultResponse", {
            peer,
            rids: [parsedMessageId.rid],
            dates: {
                dates: [parsedMessageId.date],
            },
            just_mine: {
                value: 0,
            },
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async edit_message_text(chatId, messageId, text) {
        const peer = this.requirePeer(chatId);
        const parsedMessageId = parseMessageId(messageId);
        const currentMessage = await this.findHistoryMessage(peer, parsedMessageId);
        if (!currentMessage?.message?.text_message) {
            throw new errors_1.ClientStateError(`Could not load text message ${messageId} from ${chatId}`);
        }
        currentMessage.message.text_message.text = text;
        const response = await this.invoke("bale.messaging.v2.Messaging", "UpdateMessage", "request.UpdateMessage", "response.DefaultResponse", {
            peer,
            rid: parsedMessageId.rid,
            updated_message: currentMessage.message,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async forward_message(chatId, fromChatId, messageId) {
        const peer = this.requirePeer(chatId);
        const sourcePeer = this.requirePeer(fromChatId);
        const parsedMessageId = parseMessageId(messageId);
        const response = await this.invoke("bale.messaging.v2.Messaging", "ForwardMessages", "request.ForwardMessages", "response.DefaultResponse", {
            peer,
            rid: [ws_1.BaleWebSocketConnection.createRid()],
            forwarded_messages: [
                {
                    peer: sourcePeer,
                    random_id: parsedMessageId.rid,
                    date: {
                        value: parsedMessageId.date,
                    },
                },
            ],
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async copy_message(chatId, fromChatId, messageId) {
        const peer = this.requirePeer(chatId);
        const sourcePeer = this.requirePeer(fromChatId);
        const parsedMessageId = parseMessageId(messageId);
        const sourceMessage = await this.findHistoryMessage(sourcePeer, parsedMessageId);
        if (!sourceMessage?.message) {
            throw new errors_1.ClientStateError(`Could not load source message ${messageId} from ${fromChatId}`);
        }
        const rid = ws_1.BaleWebSocketConnection.createRid();
        const response = await this.invoke("bale.messaging.v2.Messaging", "SendMessage", "request.SendMessage", "response.DefaultResponse", {
            peer,
            rid,
            message: sourceMessage.message,
            ex_peer: peer,
        });
        return this.createOutboundMessage(peer, rid, response.date, sourceMessage.message);
    }
    async get_wallet() {
        if (this.walletCache && this.walletCache.expiresAt > Date.now()) {
            return this.walletCache.value;
        }
        if (this.walletCachePromise) {
            return await this.walletCachePromise;
        }
        this.walletCachePromise = (async () => {
            const response = await this.invoke("bale.kifpool.v1.Kifpool", "GetMyKifpools", "request.GetMyKifpools", "response.GetMyKifpools", {});
            const walletResponse = (0, objects_1.wrapWalletResponse)(response);
            this.walletCache = {
                value: walletResponse,
                expiresAt: Date.now() + 60_000,
            };
            return walletResponse;
        })();
        try {
            return await this.walletCachePromise;
        }
        finally {
            this.walletCachePromise = undefined;
        }
    }
    async send_gift(chatId, amount, message, options = {}) {
        const peer = this.requirePeer(chatId);
        const walletToken = options.token ?? (await this.get_wallet()).wallet?.token;
        if (!walletToken) {
            throw new errors_1.ClientStateError("A wallet token is required to send a gift");
        }
        const response = await this.invoke("bale.giftpacket.v1.GiftPacket", "SendGiftPacketWithWallet", "request.SendGiftPacketWithWallet", "response.DefaultResponse", {
            peer,
            random_id: ws_1.BaleWebSocketConnection.createRid(),
            gift: {
                count: options.gift_count ?? 1,
                total_amount: amount,
                giving_type: options.giving_type ?? objects_1.GivingType.SAME,
                message: {
                    value: message,
                },
                owner_id: this.user?.id,
                show_amounts: {
                    value: options.show_amounts ?? true,
                },
            },
            token: walletToken,
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async open_gift(message, receiverToken) {
        const walletToken = receiverToken ?? (await this.get_wallet()).wallet?.token;
        if (!walletToken) {
            throw new errors_1.ClientStateError("A wallet token is required to open a gift");
        }
        const response = await this.invoke("bale.giftpacket.v1.GiftPacket", "OpenGiftPacket", "request.OpenGiftPacket", "response.OpenGiftPacket", {
            message: {
                peer: this.requirePeer(message.chat),
                message_id: message.rid,
                date: message.date,
            },
            receiver_token: walletToken,
            page_no: EMPTY_PAGE_NO,
            order_type: 3,
        });
        return (0, objects_1.wrapPacketResponse)(response);
    }
    async report_chat(chatId, reason, kind = objects_1.ReportKind.SPAM, source = objects_1.PeerSource.DIALOGS) {
        const peer = this.requirePeer(chatId);
        const response = await this.invoke("bale.report.v1.Report", "ReportInappropriateContent", "request.ReportInappropriateContent", "response.DefaultResponse", {
            report_body: {
                kind,
                description: reason,
                peer_report: {
                    source,
                    peer,
                },
            },
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async report_messages(chatId, messages, reason, kind = objects_1.ReportKind.SPAM) {
        const peer = this.requirePeer(chatId);
        const response = await this.invoke("bale.report.v1.Report", "ReportInappropriateContent", "request.ReportInappropriateContent", "response.DefaultResponse", {
            report_body: {
                kind,
                description: reason,
                message_report: {
                    peer,
                    messages: messages.map((message) => this.ensureOtherMessage(message)),
                },
            },
        });
        return (0, objects_1.wrapDefaultResponse)(response);
    }
    async report_message(chatId, message, reason, kind = objects_1.ReportKind.SPAM) {
        return await this.report_messages(chatId, [message], reason, kind);
    }
    async invoke(serviceName, method, requestType, responseType, payload) {
        if (!this.websocket) {
            throw new errors_1.ClientStateError("Bale userbot is not connected");
        }
        return await this.websocket.request(serviceName, method, requestType, payload, responseType);
    }
    async authenticate() {
        let sentCode;
        try {
            sentCode = await this.start_phone_auth(this.token_or_phone_number);
        }
        catch (error) {
            if (error instanceof errors_1.BaleRpcError && error.message === "PHONE_NUMBER_INVALID") {
                throw new errors_1.AuthenticationError(`Bale rejected the phone number as invalid. Use a real phone number in international format, for example "+989121234567", or pass an existing session string instead. ${formatPhoneNumberInputHint(this.token_or_phone_number)}`);
            }
            throw error;
        }
        const reader = (0, promises_2.createInterface)({ input: node_process_1.stdin, output: node_process_1.stdout });
        try {
            while (true) {
                const code = await reader.question("Enter phone code: ");
                try {
                    const auth = await this.validate_code(sentCode.transaction_hash, code.trim());
                    return this.parseAuthResponse(auth);
                }
                catch (error) {
                    if (!(error instanceof errors_1.BaleRpcError)) {
                        throw error;
                    }
                    if (error.message === "PHONE_NUMBER_UNOCCUPIED") {
                        const name = await reader.question("Enter a name for your account: ");
                        const auth = await this.sign_up(sentCode.transaction_hash, name.trim());
                        return this.parseAuthResponse(auth);
                    }
                    if (error.message === "PHONE_CODE_INVALID") {
                        continue;
                    }
                    if (!error.message || /password/i.test(error.message)) {
                        const password = await reader.question("Enter your password: ");
                        const auth = await this.validate_password(sentCode.transaction_hash, password.trim());
                        return this.parseAuthResponse(auth);
                    }
                    throw error;
                }
            }
        }
        finally {
            reader.close();
        }
    }
    parseAuthResponse(response) {
        const userId = Number(response.user?.id);
        const jwt = response.jwt?.value;
        if (!userId || !jwt) {
            throw new errors_1.AuthenticationError("Bale authentication response is incomplete");
        }
        return {
            userId,
            jwt,
        };
    }
    createOutboundMessage(peer, rid, date, message) {
        return this.wrapIncomingMessage({
            peer,
            sender_uid: this.user?.id ?? this.session?.userId ?? 0,
            date: Number(date ?? Date.now()),
            rid,
            message,
        });
    }
    async loadHistory(peer, date, limit) {
        return await this.invoke("bale.messaging.v2.Messaging", "LoadHistory", "request.LoadHistory", "response.LoadHistory", {
            peer,
            date,
            load_mode: 2,
            limit,
        });
    }
    async findHistoryMessage(peer, messageId) {
        const history = await this.loadHistory(peer, messageId.date, 20);
        const items = Array.isArray(history.history) ? history.history : [];
        return items.find((item) => Number(item.rid) === messageId.rid) ?? items[0];
    }
    requirePeer(chatId) {
        if (chatId instanceof objects_1.Chat) {
            return {
                id: chatId.peerId,
                type: chatId.peerType,
            };
        }
        const parsed = parsePeerString(chatId);
        if (!parsed) {
            throw new TypeError(`Expected a Bale peer id like "123|1", received "${chatId}"`);
        }
        return parsed;
    }
    requireGroupPeer(chatId) {
        const peer = this.requirePeer(chatId);
        return {
            group_id: peer.id,
            access_hash: 1,
        };
    }
    requireExPeer(chatId) {
        const peer = this.requirePeer(chatId);
        return {
            id: peer.id,
            type: peer.type,
            access_hash: 1,
        };
    }
    requireOutPeer(chatId) {
        const peer = this.requirePeer(chatId);
        return {
            id: peer.id,
            type: peer.type,
            access_hash: 1,
        };
    }
    ensureOtherMessage(message) {
        if (message instanceof objects_1.OtherMessage) {
            return {
                date: message.date,
                message_id: message.message_id,
                seq: message.seq !== undefined ? { value: message.seq } : undefined,
            };
        }
        return {
            date: message.date,
            message_id: message.rid,
        };
    }
    async loadPeer(peerId, peerType) {
        const cacheKey = `${peerId}|${peerType}`;
        const cachedPeer = this.peerCache.get(cacheKey);
        if (cachedPeer) {
            return cachedPeer;
        }
        const inflightPeerLoad = this.inflightPeerLoads.get(cacheKey);
        if (inflightPeerLoad) {
            return await inflightPeerLoad;
        }
        const loadPromise = this.loadPeerUncached(peerId, peerType, cacheKey);
        this.inflightPeerLoads.set(cacheKey, loadPromise);
        try {
            return await loadPromise;
        }
        finally {
            this.inflightPeerLoads.delete(cacheKey);
        }
    }
    async loadPeerUncached(peerId, peerType, cacheKey) {
        if (peerType === 1 || peerType === 4) {
            const response = await this.invoke("bale.users.v1.Users", "LoadUsers", "request.LoadUsers", "response.LoadUsers", {
                user_peers: [
                    {
                        uid: peerId,
                        access_hash: 1,
                    },
                ],
            });
            if (!response.users?.length) {
                return undefined;
            }
            const user = (0, objects_1.wrapUser)(response.users[0]);
            user.bind(this);
            this.peerCache.set(cacheKey, user);
            return user;
        }
        const response = await this.invoke("bale.groups.v1.Groups", "GetFullGroup", "request.GetFullGroup", "response.GetFullGroup", {
            peer: {
                group_id: peerId,
                access_hash: 1,
            },
        });
        if (!response.full_group) {
            return undefined;
        }
        const chat = (0, objects_1.wrapGroup)(response.full_group);
        chat.bind(this);
        this.peerCache.set(cacheKey, chat);
        return chat;
    }
    async load_session() {
        const sessionPath = this.getSessionPath();
        try {
            await (0, promises_1.access)(sessionPath);
        }
        catch {
            return undefined;
        }
        const rawSession = await (0, promises_1.readFile)(sessionPath, "utf8");
        return parseSessionString(rawSession);
    }
    async save_session(session) {
        await (0, promises_1.mkdir)(this.sessionDir, { recursive: true });
        await (0, promises_1.writeFile)(this.getSessionPath(), formatSessionString(session), "utf8");
    }
    getSessionPath() {
        return node_path_1.default.join(this.sessionDir, `${this.token_or_phone_number}.session`);
    }
    async handleUpdate(update) {
        const rawMessage = update.update?.composed_update?.message;
        if (!rawMessage || Number(rawMessage.rid) === 0) {
            return;
        }
        const message = this.wrapIncomingMessage(rawMessage);
        await this.dispatcher.dispatchMessage(this, message);
    }
    wrapIncomingMessage(rawMessage) {
        const peerId = Number(rawMessage.peer?.id);
        const peerType = Number(rawMessage.peer?.type);
        const chatKey = `${peerId}|${peerType}`;
        let chat = this.messageChatCache.get(chatKey);
        if (!chat) {
            chat = new objects_1.Chat({
                peerId,
                peerType,
            });
            chat.bind(this);
            this.messageChatCache.set(chatKey, chat);
        }
        const authorId = Number(rawMessage.sender_uid ?? 0);
        let author = this.messageAuthorCache.get(authorId);
        if (!author) {
            author = new objects_1.User({
                id: authorId,
            });
            author.bind(this);
            this.messageAuthorCache.set(authorId, author);
        }
        const message = (0, objects_1.wrapMessageFromUpdate)(rawMessage, { chat, author });
        message.bind(this);
        return message;
    }
    async handleDisconnect() {
        if (!this.running) {
            return;
        }
        this.running = false;
        await this.dispatcher.dispatchLifecycle("disconnect", this);
        if (this.stopResolver) {
            this.stopResolver();
            this.stopResolver = undefined;
        }
    }
}
exports.Client = Client;
