"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OtherMessage = exports.DefaultResponse = exports.WalletResponse = exports.Wallet = exports.PacketResponse = exports.Winner = exports.GiftPacket = exports.Message = exports.Chat = exports.User = exports.PeerSource = exports.ReportKind = exports.GiftOpenning = exports.GivingType = exports.ChatType = void 0;
exports.peerTypeToChatType = peerTypeToChatType;
exports.groupTypeToPeerType = groupTypeToPeerType;
exports.wrapUser = wrapUser;
exports.wrapGroup = wrapGroup;
exports.wrapMessageFromUpdate = wrapMessageFromUpdate;
exports.wrapGiftPacket = wrapGiftPacket;
exports.wrapWinner = wrapWinner;
exports.wrapPacketResponse = wrapPacketResponse;
exports.wrapWallet = wrapWallet;
exports.wrapWalletResponse = wrapWalletResponse;
exports.wrapDefaultResponse = wrapDefaultResponse;
var ChatType;
(function (ChatType) {
    ChatType["PRIVATE"] = "private";
    ChatType["GROUP"] = "group";
    ChatType["CHANNEL"] = "channel";
    ChatType["BOT"] = "bot";
    ChatType["SUPERGROUP"] = "supergroup";
    ChatType["THREAD"] = "thread";
    ChatType["UNKNOWN"] = "unknown";
})(ChatType || (exports.ChatType = ChatType = {}));
var GivingType;
(function (GivingType) {
    GivingType[GivingType["SAME"] = 0] = "SAME";
    GivingType[GivingType["RANDOM"] = 1] = "RANDOM";
})(GivingType || (exports.GivingType = GivingType = {}));
var GiftOpenning;
(function (GiftOpenning) {
    GiftOpenning[GiftOpenning["ALREADY_RECEIVED"] = 0] = "ALREADY_RECEIVED";
    GiftOpenning[GiftOpenning["SOLD_OUT"] = 1] = "SOLD_OUT";
    GiftOpenning[GiftOpenning["GIFT_CREATOR"] = 2] = "GIFT_CREATOR";
    GiftOpenning[GiftOpenning["SUCCESSFUL"] = 3] = "SUCCESSFUL";
    GiftOpenning[GiftOpenning["PENDING"] = 4] = "PENDING";
})(GiftOpenning || (exports.GiftOpenning = GiftOpenning = {}));
var ReportKind;
(function (ReportKind) {
    ReportKind[ReportKind["UNKNOWN"] = 0] = "UNKNOWN";
    ReportKind[ReportKind["SCAM"] = 1] = "SCAM";
    ReportKind[ReportKind["INAPPROPRIATE_CONTENT"] = 2] = "INAPPROPRIATE_CONTENT";
    ReportKind[ReportKind["OTHER"] = 3] = "OTHER";
    ReportKind[ReportKind["VIOLENCE"] = 4] = "VIOLENCE";
    ReportKind[ReportKind["SPAM"] = 5] = "SPAM";
    ReportKind[ReportKind["FALSE_INFORMATION"] = 6] = "FALSE_INFORMATION";
})(ReportKind || (exports.ReportKind = ReportKind = {}));
var PeerSource;
(function (PeerSource) {
    PeerSource[PeerSource["UNKNOWN"] = 0] = "UNKNOWN";
    PeerSource[PeerSource["DIALOGS"] = 1] = "DIALOGS";
    PeerSource[PeerSource["VITRINE"] = 2] = "VITRINE";
    PeerSource[PeerSource["MARKET"] = 3] = "MARKET";
    PeerSource[PeerSource["PRIVACY_BAR"] = 4] = "PRIVACY_BAR";
})(PeerSource || (exports.PeerSource = PeerSource = {}));
class User {
    id;
    username;
    name;
    isBot;
    client;
    constructor(options) {
        this.id = options.id;
        this.username = options.username;
        this.name = options.name;
        this.isBot = options.isBot ?? false;
    }
    get full_name() {
        return this.name ?? "";
    }
    bind(client) {
        this.client = client;
    }
}
exports.User = User;
class Chat {
    peerId;
    peerType;
    id;
    title;
    username;
    firstName;
    lastName;
    type;
    client;
    constructor(options) {
        this.peerId = options.peerId;
        this.peerType = options.peerType;
        this.id = `${options.peerId}|${options.peerType}`;
        this.title = options.title;
        this.username = options.username;
        this.firstName = options.firstName;
        this.lastName = options.lastName;
        this.type = options.type ?? peerTypeToChatType(options.peerType);
    }
    get full_name() {
        if (this.firstName && this.lastName) {
            return `${this.firstName} ${this.lastName}`;
        }
        if (this.firstName) {
            return this.firstName;
        }
        return this.title ?? "";
    }
    async send(text) {
        if (!this.client) {
            throw new Error("Chat is not bound to a client");
        }
        return await this.client.send_message(this.id, text);
    }
    async load_history(limit = 20, fromDate = -1) {
        if (!this.client) {
            throw new Error("Chat is not bound to a client");
        }
        return await this.client.load_history(this.id, fromDate, limit);
    }
    async send_gift(amount, message, options) {
        if (!this.client) {
            throw new Error("Chat is not bound to a client");
        }
        return await this.client.send_gift(this.id, amount, message, options);
    }
    async report(reason, kind = ReportKind.SPAM) {
        if (!this.client) {
            throw new Error("Chat is not bound to a client");
        }
        return await this.client.report_chat(this.id, reason, kind);
    }
    bind(client) {
        this.client = client;
    }
}
exports.Chat = Chat;
class Message {
    rid;
    date;
    id;
    author;
    chat;
    text;
    caption;
    gift;
    raw;
    client;
    constructor(options) {
        this.rid = options.rid;
        this.date = options.date;
        this.id = `${options.rid}|${options.date}`;
        this.author = options.author;
        this.chat = options.chat;
        this.text = options.text;
        this.caption = options.caption;
        this.gift = options.gift;
        this.raw = options.raw;
    }
    get content() {
        return this.text ?? this.caption ?? "";
    }
    async reply(text) {
        if (!this.client) {
            throw new Error("Message is not bound to a client");
        }
        return await this.client.send_message(this.chat.id, text);
    }
    async edit_text(text) {
        if (!this.client) {
            throw new Error("Message is not bound to a client");
        }
        return await this.client.edit_message_text(this.chat.id, this.id, text);
    }
    async delete() {
        if (!this.client) {
            throw new Error("Message is not bound to a client");
        }
        return await this.client.delete_message(this.chat.id, this.id);
    }
    async forward(chatId) {
        if (!this.client) {
            throw new Error("Message is not bound to a client");
        }
        return await this.client.forward_message(chatId, this.chat.id, this.id);
    }
    async copy(chatId) {
        if (!this.client) {
            throw new Error("Message is not bound to a client");
        }
        return await this.client.copy_message(chatId, this.chat.id, this.id);
    }
    async open_gift(receiverToken) {
        if (!this.client) {
            throw new Error("Message is not bound to a client");
        }
        return await this.client.open_gift(this, receiverToken);
    }
    async report(reason, kind = ReportKind.SPAM) {
        if (!this.client) {
            throw new Error("Message is not bound to a client");
        }
        return await this.client.report_message(this.chat.id, this, reason, kind);
    }
    bind(client) {
        this.client = client;
        this.author.bind(client);
        this.chat.bind(client);
        this.gift?.bind(client);
    }
}
exports.Message = Message;
class GiftPacket {
    count;
    total_amount;
    giving_type;
    token;
    message;
    owner_id;
    show_amounts;
    client;
    constructor(options = {}) {
        this.count = options.count ?? 0;
        this.total_amount = options.totalAmount ?? 0;
        this.giving_type = options.givingType ?? GivingType.SAME;
        this.token = options.token;
        this.message = options.message;
        this.owner_id = options.ownerId;
        this.show_amounts = options.showAmounts ?? false;
    }
    bind(client) {
        this.client = client;
    }
}
exports.GiftPacket = GiftPacket;
class Winner {
    id;
    amount;
    date;
    constructor(options) {
        this.id = options.id;
        this.amount = options.amount ?? 0;
        this.date = options.date;
    }
}
exports.Winner = Winner;
class PacketResponse {
    receivers;
    status;
    openned_count;
    win_amount;
    rank;
    constructor(options = {}) {
        this.receivers = options.receivers ?? [];
        this.status = options.status ?? GiftOpenning.ALREADY_RECEIVED;
        this.openned_count = options.opennedCount ?? 0;
        this.win_amount = options.winAmount ?? 0;
        this.rank = options.rank ?? 0;
    }
}
exports.PacketResponse = PacketResponse;
class Wallet {
    is_merchant;
    app;
    balance;
    token;
    level;
    pan;
    account;
    constructor(options) {
        this.is_merchant = options.isMerchant ?? false;
        this.app = options.app;
        this.balance = options.balance ?? 0;
        this.token = options.token;
        this.level = options.level ?? 0;
        this.pan = options.pan;
        this.account = options.account;
    }
}
exports.Wallet = Wallet;
class WalletResponse {
    wallet;
    first_name;
    last_name;
    constructor(options = {}) {
        this.wallet = options.wallet;
        this.first_name = options.firstName;
        this.last_name = options.lastName;
    }
}
exports.WalletResponse = WalletResponse;
class DefaultResponse {
    seq;
    date;
    constructor(options = {}) {
        this.seq = options.seq;
        this.date = options.date;
    }
}
exports.DefaultResponse = DefaultResponse;
class OtherMessage {
    date;
    message_id;
    seq;
    constructor(options) {
        this.date = options.date;
        this.message_id = options.messageId;
        this.seq = options.seq;
    }
}
exports.OtherMessage = OtherMessage;
function peerTypeToChatType(peerType) {
    switch (peerType) {
        case 1:
            return ChatType.PRIVATE;
        case 2:
            return ChatType.GROUP;
        case 3:
            return ChatType.CHANNEL;
        case 4:
            return ChatType.BOT;
        case 5:
            return ChatType.SUPERGROUP;
        case 6:
            return ChatType.THREAD;
        default:
            return ChatType.UNKNOWN;
    }
}
function groupTypeToPeerType(groupType) {
    if (groupType === "GROUP_TYPE_CHANNEL" || groupType === 1) {
        return 3;
    }
    if (groupType === "GROUP_TYPE_SUPER_GROUP" || groupType === 2) {
        return 5;
    }
    return 2;
}
function wrapUser(raw) {
    return new User({
        id: Number(raw.id),
        username: raw.nick?.value,
        name: raw.name,
        isBot: Boolean(raw.is_bot?.value),
    });
}
function wrapGroup(raw) {
    return new Chat({
        peerId: Number(raw.id),
        peerType: groupTypeToPeerType(raw.group_type),
        title: raw.title,
        username: raw.nick?.value,
    });
}
function wrapMessageFromUpdate(raw, context = {}) {
    const chat = context.chat ?? new Chat({
        peerId: Number(raw.peer?.id),
        peerType: Number(raw.peer?.type),
    });
    const author = context.author ?? new User({
        id: Number(raw.sender_uid),
    });
    return new Message({
        rid: Number(raw.rid),
        date: Number(raw.date),
        author,
        chat,
        text: raw.message?.text_message?.text,
        caption: raw.message?.document_message?.caption?.text,
        gift: raw.message?.gift ? wrapGiftPacket(raw.message.gift) : undefined,
        raw,
    });
}
function wrapGiftPacket(raw) {
    return new GiftPacket({
        count: Number(raw.count ?? 0),
        totalAmount: Number(raw.total_amount ?? 0),
        givingType: raw.giving_type === "GIVING_TYPE_RANDOM" || raw.giving_type === 1 ? GivingType.RANDOM : GivingType.SAME,
        token: raw.token?.value,
        message: raw.message?.value,
        ownerId: raw.owner_id !== undefined ? Number(raw.owner_id) : undefined,
        showAmounts: Boolean(raw.show_amounts?.value),
    });
}
function wrapWinner(raw) {
    return new Winner({
        id: Number(raw.id),
        amount: Number(raw.amount ?? 0),
        date: raw.date !== undefined ? Number(raw.date) : undefined,
    });
}
function wrapPacketResponse(raw) {
    return new PacketResponse({
        receivers: Array.isArray(raw.receivers) ? raw.receivers.map(wrapWinner) : [],
        status: typeof raw.status === "string" ? giftOpenningFromString(raw.status) : Number(raw.status ?? 0),
        opennedCount: Number(raw.openned_count ?? 0),
        winAmount: Number(raw.win_amount?.value ?? 0),
        rank: Number(raw.rank?.value ?? 0),
    });
}
function wrapWallet(raw) {
    return new Wallet({
        isMerchant: Boolean(raw.is_merchant?.value),
        app: raw.app,
        balance: Number(raw.balance ?? 0),
        token: raw.token,
        level: Number(raw.level ?? 0),
        pan: raw.pan?.value,
        account: raw.account?.value,
    });
}
function wrapWalletResponse(raw) {
    const walletValue = Array.isArray(raw.wallet) ? raw.wallet[0] : raw.wallet;
    return new WalletResponse({
        wallet: walletValue ? wrapWallet(walletValue) : undefined,
        firstName: raw.first_name?.value,
        lastName: raw.last_name?.value,
    });
}
function wrapDefaultResponse(raw) {
    return new DefaultResponse({
        seq: raw.seq !== undefined ? Number(raw.seq) : undefined,
        date: raw.date !== undefined ? Number(raw.date) : undefined,
    });
}
function giftOpenningFromString(value) {
    switch (value) {
        case "GIFT_OPENNING_SOLD_OUT":
            return GiftOpenning.SOLD_OUT;
        case "GIFT_OPENNING_GIFT_CREATOR":
            return GiftOpenning.GIFT_CREATOR;
        case "GIFT_OPENNING_SUCCESSFUL":
            return GiftOpenning.SUCCESSFUL;
        case "GIFT_OPENNING_PENDING":
            return GiftOpenning.PENDING;
        default:
            return GiftOpenning.ALREADY_RECEIVED;
    }
}
