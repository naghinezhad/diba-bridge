import { EventEmitter } from "node:events";
export interface WebSocketConnectionOptions {
    websocketUri?: string;
    origin?: string;
    timeoutSeconds?: number;
    appVersion?: number;
    browserType?: string;
    browserVersion?: number;
    osType?: string;
}
export declare class BaleWebSocketConnection extends EventEmitter {
    readonly accessToken: string;
    readonly websocketUri: string;
    readonly origin: string;
    readonly timeoutSeconds: number;
    readonly appVersion: number;
    readonly browserType: string;
    readonly browserVersion: number;
    readonly osType: string;
    private socket?;
    private sessionId?;
    private nextIndex;
    private readonly pendingResponses;
    private keepAliveTimer?;
    private requestMetadata?;
    private encodedKeepAlive?;
    private static nextRid;
    constructor(accessToken: string, options?: WebSocketConnectionOptions);
    static createRid(): number;
    start(): Promise<void>;
    stop(): Promise<void>;
    keepAlive(): Promise<void>;
    sendRaw(typeName: string, payload: object): Promise<void>;
    sendEncoded(content: Buffer): Promise<void>;
    request<TResponse>(serviceName: string, method: string, requestType: string, payload: object, responseType?: string): Promise<TResponse>;
    private buildRequestMetadata;
    private handleIncoming;
    private failPending;
}
