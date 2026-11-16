"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Dispatcher = void 0;
class Dispatcher {
    messageHandlers = [];
    errorHandlers = [];
    lifecycleHandlers = {
        connect: [],
        disconnect: [],
        initialize: [],
        shutdown: [],
    };
    addMessageHandler(callback, condition) {
        this.messageHandlers.push({ callback, condition });
        return callback;
    }
    addErrorHandler(callback) {
        this.errorHandlers.push(callback);
        return callback;
    }
    addLifecycleHandler(event, callback) {
        this.lifecycleHandlers[event].push(callback);
        return callback;
    }
    async dispatchMessage(client, message) {
        if (this.messageHandlers.length === 0) {
            return;
        }
        for (const handler of this.messageHandlers) {
            try {
                if (handler.condition && !(await handler.condition.matches(client, message))) {
                    continue;
                }
                await handler.callback(message, client);
            }
            catch (error) {
                await this.dispatchError(client, error);
            }
        }
    }
    async dispatchError(client, error) {
        if (this.errorHandlers.length === 0) {
            throw error;
        }
        for (const handler of this.errorHandlers) {
            await handler(error, client);
        }
    }
    async dispatchLifecycle(event, client) {
        if (this.lifecycleHandlers[event].length === 0) {
            return;
        }
        for (const handler of this.lifecycleHandlers[event]) {
            await handler(client);
        }
    }
}
exports.Dispatcher = Dispatcher;
