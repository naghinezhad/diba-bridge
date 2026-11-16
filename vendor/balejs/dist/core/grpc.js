"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaleGrpcConnection = void 0;
const node_http2_1 = __importDefault(require("node:http2"));
const errors_1 = require("../errors");
const proto_1 = require("./proto");
function normalizedTimestamp() {
    return String(Date.now());
}
function grpcFrame(content) {
    const body = Buffer.from(content);
    const frame = Buffer.allocUnsafe(body.length + 5);
    frame.writeUInt8(0, 0);
    frame.writeUInt32BE(body.length, 1);
    body.copy(frame, 5);
    return frame;
}
function stripGrpcFrame(content) {
    return content.subarray(5, 5 + content.readUInt32BE(1));
}
function headerValue(value) {
    if (Array.isArray(value)) {
        return value[0];
    }
    if (typeof value === "number") {
        return String(value);
    }
    return value;
}
class BaleGrpcConnection {
    baseUrl;
    origin;
    appVersion;
    browserType;
    browserVersion;
    osType;
    userAgent;
    sessionId;
    baseHeaders;
    client;
    constructor(options = {}) {
        this.baseUrl = options.baseUrl ?? "https://next-ws.bale.ai";
        this.origin = options.origin ?? "https://web.bale.ai";
        this.appVersion = options.appVersion ?? "113466";
        this.browserType = options.browserType ?? "1";
        this.browserVersion = options.browserVersion ?? "138.0.0.0";
        this.osType = options.osType ?? "3";
        this.userAgent =
            options.userAgent ??
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
        this.sessionId = normalizedTimestamp();
        this.baseHeaders = {
            "content-type": "application/grpc-web+proto",
            "user-agent": this.userAgent,
            "app_version": this.appVersion,
            "browser_type": this.browserType,
            "browser_version": this.browserVersion,
            "os_type": this.osType,
            "mt_app_version": this.appVersion,
            "mt_browser_type": this.browserType,
            "mt_browser_version": this.browserVersion,
            "mt_os_type": this.osType,
            "mt_session_id": this.sessionId,
            "origin": this.origin,
            "session_id": this.sessionId,
        };
    }
    close() {
        if (!this.client || this.client.closed || this.client.destroyed) {
            this.client = undefined;
            return;
        }
        this.client.close();
        this.client = undefined;
    }
    async request(service, requestType, responseType, payload) {
        const client = this.getClient();
        const body = grpcFrame((0, proto_1.encodeMessage)(requestType, payload));
        try {
            const { headers, trailers, responseBody } = await new Promise((resolve, reject) => {
                const chunks = [];
                let responseHeaders = {};
                let responseTrailers = {};
                const stream = client.request({
                    ":method": "POST",
                    ":path": `/${service}`,
                    ...this.baseHeaders,
                });
                stream.on("response", (incomingHeaders) => {
                    responseHeaders = incomingHeaders;
                });
                stream.on("trailers", (incomingTrailers) => {
                    responseTrailers = incomingTrailers;
                });
                stream.on("data", (chunk) => {
                    chunks.push(chunk);
                });
                stream.on("end", () => {
                    resolve({
                        headers: responseHeaders,
                        trailers: responseTrailers,
                        responseBody: Buffer.concat(chunks),
                    });
                });
                stream.on("error", reject);
                stream.end(body);
            });
            const statusValue = headerValue(trailers["grpc-status"]) ?? headerValue(headers["grpc-status"]) ?? "0";
            const status = Number(statusValue);
            if (!Number.isNaN(status) && status !== 0) {
                const message = headerValue(trailers["grpc-message"]) ?? headerValue(headers["grpc-message"]) ?? "Unknown gRPC error";
                throw new errors_1.BaleRpcError(status, message, service);
            }
            return (0, proto_1.decodeMessage)(responseType, stripGrpcFrame(responseBody));
        }
        catch (error) {
            if (this.client && (this.client.closed || this.client.destroyed)) {
                this.client = undefined;
            }
            throw error;
        }
    }
    getClient() {
        if (!this.client || this.client.closed || this.client.destroyed) {
            this.client = node_http2_1.default.connect(this.baseUrl);
            // Patched for Node.js 24+: do not touch ClientHttp2Session.socket (see PATCHES.md).
            this.client.on("error", () => {
                this.client = undefined;
            });
            this.client.on("close", () => {
                this.client = undefined;
            });
        }
        return this.client;
    }
}
exports.BaleGrpcConnection = BaleGrpcConnection;
