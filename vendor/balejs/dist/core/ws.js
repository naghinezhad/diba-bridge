"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaleWebSocketConnection = void 0;
const node_events_1 = require("node:events");
const ws_1 = __importDefault(require("ws"));
const errors_1 = require("../errors");
const proto_1 = require("./proto");
function normalizedTimestamp() {
    return String(Date.now());
}
function rawDataToBuffer(data) {
    if (Buffer.isBuffer(data)) {
        return data;
    }
    if (Array.isArray(data)) {
        return Buffer.concat(data);
    }
    return Buffer.from(data);
}
class BaleWebSocketConnection extends node_events_1.EventEmitter {
    accessToken;
    websocketUri;
    origin;
    timeoutSeconds;
    appVersion;
    browserType;
    browserVersion;
    osType;
    socket;
    sessionId;
    nextIndex = 1;
    pendingResponses = new Map();
    keepAliveTimer;
    requestMetadata;
    encodedKeepAlive;
    static nextRid = Date.now() * 1000;
    constructor(accessToken, options = {}) {
        super();
        this.accessToken = accessToken;
        this.websocketUri = options.websocketUri ?? "wss://next-ws.bale.ai/ws/";
        this.origin = options.origin ?? "https://web.bale.ai";
        this.timeoutSeconds = options.timeoutSeconds ?? 20;
        this.appVersion = options.appVersion ?? 86550;
        this.browserType = options.browserType ?? "1";
        this.browserVersion = options.browserVersion ?? 3471765337684194354;
        this.osType = options.osType ?? "3";
    }
    static createRid() {
        return ++this.nextRid;
    }
    async start() {
        if (this.socket && this.socket.readyState === ws_1.default.OPEN) {
            return;
        }
        this.sessionId = normalizedTimestamp();
        this.requestMetadata = this.buildRequestMetadata();
        this.encodedKeepAlive = Buffer.from((0, proto_1.encodeMessage)("request.KeepAliveRequest", {
            payloads: {
                value_should_2: 2,
            },
        }));
        this.socket = new ws_1.default(this.websocketUri, {
            origin: this.origin,
            perMessageDeflate: false,
            skipUTF8Validation: true,
            headers: {
                Cookie: `access_token=${this.accessToken}`,
            },
        });
        await new Promise((resolve, reject) => {
            const socket = this.socket;
            if (!socket) {
                reject(new errors_1.ClientStateError("WebSocket was not created"));
                return;
            }
            const onOpen = () => {
                cleanup();
                resolve();
            };
            const onError = (error) => {
                cleanup();
                reject(error);
            };
            const cleanup = () => {
                socket.off("open", onOpen);
                socket.off("error", onError);
            };
            socket.once("open", onOpen);
            socket.once("error", onError);
            socket.on("message", (data) => {
                void this.handleIncoming(data);
            });
            socket.on("close", () => {
                this.failPending(new errors_1.ClientStateError("Bale websocket closed"));
                this.emit("close");
            });
            socket.on("error", (error) => {
                this.failPending(error instanceof Error ? error : new Error(String(error)));
                this.emit("error", error);
            });
        });
        await this.keepAlive();
        this.keepAliveTimer = setInterval(() => {
            void this.keepAlive().catch(() => {
                return;
            });
        }, 15000);
    }
    async stop() {
        if (!this.socket) {
            return;
        }
        const socket = this.socket;
        this.socket = undefined;
        this.failPending(new errors_1.ClientStateError("Bale websocket stopped"));
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = undefined;
        }
        await new Promise((resolve) => {
            socket.once("close", () => resolve());
            socket.close();
        });
    }
    async keepAlive() {
        if (!this.encodedKeepAlive) {
            throw new errors_1.ClientStateError("Bale websocket keepalive payload is not initialized");
        }
        await this.sendEncoded(this.encodedKeepAlive);
    }
    async sendRaw(typeName, payload) {
        await this.sendEncoded(Buffer.from((0, proto_1.encodeMessage)(typeName, payload)));
    }
    async sendEncoded(content) {
        const socket = this.socket;
        if (!socket || socket.readyState !== ws_1.default.OPEN) {
            throw new errors_1.ClientStateError("Bale websocket is not connected");
        }
        await new Promise((resolve, reject) => {
            socket.send(content, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
    async request(serviceName, method, requestType, payload, responseType) {
        const requestIndex = this.nextIndex++;
        const responsePromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingResponses.delete(requestIndex);
                reject(new errors_1.ClientStateError(`Timed out waiting for Bale response ${requestIndex}`));
            }, this.timeoutSeconds * 1000);
            this.pendingResponses.set(requestIndex, {
                responseType,
                resolve,
                reject,
                timer,
            });
        });
        try {
            await this.sendEncoded(Buffer.from((0, proto_1.encodeMessage)("request.Request", {
                ws_request: {
                    service_name: serviceName,
                    method,
                    payload: (0, proto_1.encodeMessage)(requestType, payload),
                    metadata: this.requestMetadata,
                    index: requestIndex,
                },
            })));
        }
        catch (error) {
            const pending = this.pendingResponses.get(requestIndex);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingResponses.delete(requestIndex);
            }
            throw error;
        }
        return await responsePromise;
    }
    buildRequestMetadata() {
        return {
            key_values: [
                {
                    key: "app_version",
                    value: {
                        string_value: String(this.appVersion),
                    },
                },
                {
                    key: "browser_type",
                    value: {
                        string_value: this.browserType,
                    },
                },
                {
                    key: "browser_version",
                    value: {
                        msg_value: {
                            fixed64_value: this.browserVersion,
                        },
                    },
                },
                {
                    key: "os_type",
                    value: {
                        string_value: this.osType,
                    },
                },
                {
                    key: "session_id",
                    value: {
                        string_value: this.sessionId,
                    },
                },
            ],
        };
    }
    async handleIncoming(data) {
        const payload = rawDataToBuffer(data);
        const response = (0, proto_1.decodeMessage)("response.Response", payload);
        if (response.ws_update) {
            this.emit("update", response.ws_update);
            return;
        }
        const wsResponse = response.ws_response;
        if (!wsResponse) {
            return;
        }
        const index = Number(wsResponse.index);
        const pending = this.pendingResponses.get(index);
        if (!pending) {
            return;
        }
        this.pendingResponses.delete(index);
        clearTimeout(pending.timer);
        if (wsResponse.error) {
            const error = wsResponse.error;
            pending.reject(new errors_1.BaleRpcError(Number(error.code), String(error.message ?? "Unknown Bale websocket error"), methodNameFromResponse(wsResponse)));
            return;
        }
        try {
            if (pending.responseType) {
                pending.resolve((0, proto_1.decodeMessage)(pending.responseType, wsResponse.response));
                return;
            }
            pending.resolve(wsResponse.response);
        }
        catch (error) {
            pending.reject(error);
        }
    }
    failPending(error) {
        for (const [index, pending] of this.pendingResponses) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pendingResponses.delete(index);
        }
    }
}
exports.BaleWebSocketConnection = BaleWebSocketConnection;
function methodNameFromResponse(response) {
    return typeof response.method === "string" ? response.method : undefined;
}
