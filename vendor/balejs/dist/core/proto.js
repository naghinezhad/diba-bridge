"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.protoRoot = void 0;
exports.encodeMessage = encodeMessage;
exports.decodeMessage = decodeMessage;
const node_path_1 = __importDefault(require("node:path"));
const protobufjs_1 = __importDefault(require("protobufjs"));
const conversionOptions = {
    longs: Number,
    bytes: Buffer,
    enums: String,
    defaults: false,
};
const shouldVerifyMessages = process.env.BALE_VERIFY_PROTO === "1";
const typeCache = new Map();
const protoRoot = new protobufjs_1.default.Root();
exports.protoRoot = protoRoot;
protoRoot.loadSync([
    node_path_1.default.resolve(__dirname, "..", "proto", "struct.proto"),
    node_path_1.default.resolve(__dirname, "..", "proto", "request.proto"),
    node_path_1.default.resolve(__dirname, "..", "proto", "response.proto"),
], {
    keepCase: true,
});
protoRoot.resolveAll();
function lookupType(typeName) {
    const cachedType = typeCache.get(typeName);
    if (cachedType) {
        return cachedType;
    }
    const messageType = protoRoot.lookupType(typeName);
    typeCache.set(typeName, messageType);
    return messageType;
}
function encodeMessage(typeName, payload) {
    const messageType = lookupType(typeName);
    if (shouldVerifyMessages) {
        const err = messageType.verify(payload);
        if (err) {
            throw new TypeError(`Invalid ${typeName} payload: ${err}`);
        }
    }
    return messageType.encode(messageType.create(payload)).finish();
}
function decodeMessage(typeName, payload) {
    const messageType = lookupType(typeName);
    const decoded = messageType.decode(payload);
    return messageType.toObject(decoded, conversionOptions);
}
