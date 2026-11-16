"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientStateError = exports.AuthenticationError = exports.BaleRpcError = void 0;
class BaleRpcError extends Error {
    code;
    reason;
    constructor(code, message, reason) {
        super(message || `Bale RPC error ${code}`);
        this.name = "BaleRpcError";
        this.code = code;
        this.reason = reason;
    }
}
exports.BaleRpcError = BaleRpcError;
class AuthenticationError extends Error {
    constructor(message) {
        super(message);
        this.name = "AuthenticationError";
    }
}
exports.AuthenticationError = AuthenticationError;
class ClientStateError extends Error {
    constructor(message) {
        super(message);
        this.name = "ClientStateError";
    }
}
exports.ClientStateError = ClientStateError;
