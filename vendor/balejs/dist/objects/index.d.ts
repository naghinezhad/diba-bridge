import type { Client } from "../client";
export declare enum ChatType {
    PRIVATE = "private",
    GROUP = "group",
    CHANNEL = "channel",
    BOT = "bot",
    SUPERGROUP = "supergroup",
    THREAD = "thread",
    UNKNOWN = "unknown"
}
export declare enum GivingType {
    SAME = 0,
    RANDOM = 1
}
export declare enum GiftOpenning {
    ALREADY_RECEIVED = 0,
    SOLD_OUT = 1,
    GIFT_CREATOR = 2,
    SUCCESSFUL = 3,
    PENDING = 4
}
export declare enum ReportKind {
    UNKNOWN = 0,
    SCAM = 1,
    INAPPROPRIATE_CONTENT = 2,
    OTHER = 3,
    VIOLENCE = 4,
    SPAM = 5,
    FALSE_INFORMATION = 6
}
export declare enum PeerSource {
    UNKNOWN = 0,
    DIALOGS = 1,
    VITRINE = 2,
    MARKET = 3,
    PRIVACY_BAR = 4
}
export interface Bindable {
    bind(client: Client): void;
}
export interface UserOptions {
    id: number;
    username?: string;
    name?: string;
    isBot?: boolean;
}
export interface ChatOptions {
    peerId: number;
    peerType: number;
    title?: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    type?: ChatType;
}
export interface MessageOptions {
    rid: number;
    date: number;
    author: User;
    chat: Chat;
    text?: string;
    caption?: string;
    gift?: GiftPacket;
    raw?: unknown;
}
export interface MessageWrapContext {
    author?: User;
    chat?: Chat;
}
export interface GiftPacketOptions {
    count?: number;
    totalAmount?: number;
    givingType?: GivingType;
    token?: string;
    message?: string;
    ownerId?: number;
    showAmounts?: boolean;
}
export interface WinnerOptions {
    id: number;
    amount?: number;
    date?: number;
}
export interface PacketResponseOptions {
    receivers?: Winner[];
    status?: GiftOpenning;
    opennedCount?: number;
    winAmount?: number;
    rank?: number;
}
export interface WalletOptions {
    isMerchant?: boolean;
    app?: string;
    balance?: number;
    token: string;
    level?: number;
    pan?: string;
    account?: string;
}
export interface WalletResponseOptions {
    wallet?: Wallet;
    firstName?: string;
    lastName?: string;
}
export interface DefaultResponseOptions {
    seq?: number;
    date?: number;
}
export interface OtherMessageOptions {
    date: number;
    messageId: number;
    seq?: number;
}
export declare class User implements Bindable {
    readonly id: number;
    readonly username?: string;
    readonly name?: string;
    readonly isBot: boolean;
    protected client?: Client;
    constructor(options: UserOptions);
    get full_name(): string;
    bind(client: Client): void;
}
export declare class Chat implements Bindable {
    readonly peerId: number;
    readonly peerType: number;
    readonly id: string;
    readonly title?: string;
    readonly username?: string;
    readonly firstName?: string;
    readonly lastName?: string;
    readonly type: ChatType;
    protected client?: Client;
    constructor(options: ChatOptions);
    get full_name(): string;
    send(text: string): Promise<unknown>;
    load_history(limit?: number, fromDate?: number): Promise<Message[]>;
    send_gift(amount: number, message: string, options?: {
        gift_count?: number;
        giving_type?: GivingType;
        show_amounts?: boolean;
        token?: string;
    }): Promise<unknown>;
    report(reason?: string, kind?: ReportKind): Promise<unknown>;
    bind(client: Client): void;
}
export declare class Message implements Bindable {
    readonly rid: number;
    readonly date: number;
    readonly id: string;
    readonly author: User;
    readonly chat: Chat;
    readonly text?: string;
    readonly caption?: string;
    readonly gift?: GiftPacket;
    readonly raw?: unknown;
    protected client?: Client;
    constructor(options: MessageOptions);
    get content(): string;
    reply(text: string): Promise<unknown>;
    edit_text(text: string): Promise<unknown>;
    delete(): Promise<unknown>;
    forward(chatId: string): Promise<unknown>;
    copy(chatId: string): Promise<unknown>;
    open_gift(receiverToken?: string): Promise<unknown>;
    report(reason?: string, kind?: ReportKind): Promise<unknown>;
    bind(client: Client): void;
}
export declare class GiftPacket implements Bindable {
    readonly count: number;
    readonly total_amount: number;
    readonly giving_type: GivingType;
    readonly token?: string;
    readonly message?: string;
    readonly owner_id?: number;
    readonly show_amounts: boolean;
    protected client?: Client;
    constructor(options?: GiftPacketOptions);
    bind(client: Client): void;
}
export declare class Winner {
    readonly id: number;
    readonly amount: number;
    readonly date?: number;
    constructor(options: WinnerOptions);
}
export declare class PacketResponse {
    readonly receivers: Winner[];
    readonly status: GiftOpenning;
    readonly openned_count: number;
    readonly win_amount: number;
    readonly rank: number;
    constructor(options?: PacketResponseOptions);
}
export declare class Wallet {
    readonly is_merchant: boolean;
    readonly app?: string;
    readonly balance: number;
    readonly token: string;
    readonly level: number;
    readonly pan?: string;
    readonly account?: string;
    constructor(options: WalletOptions);
}
export declare class WalletResponse {
    readonly wallet?: Wallet;
    readonly first_name?: string;
    readonly last_name?: string;
    constructor(options?: WalletResponseOptions);
}
export declare class DefaultResponse {
    readonly seq?: number;
    readonly date?: number;
    constructor(options?: DefaultResponseOptions);
}
export declare class OtherMessage {
    readonly date: number;
    readonly message_id: number;
    readonly seq?: number;
    constructor(options: OtherMessageOptions);
}
export declare function peerTypeToChatType(peerType: number): ChatType;
export declare function groupTypeToPeerType(groupType: string | number | undefined): number;
export declare function wrapUser(raw: Record<string, any>): User;
export declare function wrapGroup(raw: Record<string, any>): Chat;
export declare function wrapMessageFromUpdate(raw: Record<string, any>, context?: MessageWrapContext): Message;
export declare function wrapGiftPacket(raw: Record<string, any>): GiftPacket;
export declare function wrapWinner(raw: Record<string, any>): Winner;
export declare function wrapPacketResponse(raw: Record<string, any>): PacketResponse;
export declare function wrapWallet(raw: Record<string, any>): Wallet;
export declare function wrapWalletResponse(raw: Record<string, any>): WalletResponse;
export declare function wrapDefaultResponse(raw: Record<string, any>): DefaultResponse;
