"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.private = exports.channel = exports.group = exports.private_ = exports.gift = exports.content = exports.text = exports.not = exports.create = exports.any = exports.all = exports.Condition = void 0;
exports.command = command;
const objects_1 = require("../objects");
const condition_1 = require("./condition");
Object.defineProperty(exports, "Condition", { enumerable: true, get: function () { return condition_1.Condition; } });
Object.defineProperty(exports, "all", { enumerable: true, get: function () { return condition_1.all; } });
Object.defineProperty(exports, "any", { enumerable: true, get: function () { return condition_1.any; } });
Object.defineProperty(exports, "create", { enumerable: true, get: function () { return condition_1.create; } });
Object.defineProperty(exports, "not", { enumerable: true, get: function () { return condition_1.not; } });
exports.text = new condition_1.Condition((_client, message) => {
    return Boolean(message.text);
}, "text");
exports.content = new condition_1.Condition((_client, message) => {
    return Boolean(message.content);
}, "content");
exports.gift = new condition_1.Condition((_client, message) => {
    return Boolean(message.gift);
}, "gift");
exports.private_ = new condition_1.Condition((_client, message) => {
    return message.chat.type === objects_1.ChatType.PRIVATE;
}, "private");
exports.private = exports.private_;
exports.group = new condition_1.Condition((_client, message) => {
    return message.chat.type === objects_1.ChatType.GROUP || message.chat.type === objects_1.ChatType.SUPERGROUP;
}, "group");
exports.channel = new condition_1.Condition((_client, message) => {
    return message.chat.type === objects_1.ChatType.CHANNEL;
}, "channel");
function command(name, prefix = "/", minArguments, maxArguments) {
    return new condition_1.Condition((_client, message) => {
        if (!message.text) {
            return false;
        }
        const [commandName, ...argumentsList] = message.text.trim().split(/\s+/);
        if (commandName.toLowerCase() !== `${prefix}${name.toLowerCase()}`) {
            return false;
        }
        if (minArguments !== undefined && argumentsList.length < minArguments) {
            return false;
        }
        if (maxArguments !== undefined && argumentsList.length > maxArguments) {
            return false;
        }
        return true;
    }, `command(${name})`);
}
