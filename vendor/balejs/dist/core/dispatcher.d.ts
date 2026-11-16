import type { Condition } from "../conditions";
import type { Client } from "../client";
import type { Message } from "../objects";
type MaybePromise<T> = T | Promise<T>;
type LifecycleEvent = "connect" | "disconnect" | "initialize" | "shutdown";
type MessageCallback = (message: Message, client: Client) => MaybePromise<unknown>;
type ErrorCallback = (error: unknown, client: Client) => MaybePromise<unknown>;
type LifecycleCallback = (client: Client) => MaybePromise<unknown>;
export declare class Dispatcher {
    private readonly messageHandlers;
    private readonly errorHandlers;
    private readonly lifecycleHandlers;
    addMessageHandler(callback: MessageCallback, condition?: Condition<Message>): MessageCallback;
    addErrorHandler(callback: ErrorCallback): ErrorCallback;
    addLifecycleHandler(event: LifecycleEvent, callback: LifecycleCallback): LifecycleCallback;
    dispatchMessage(client: Client, message: Message): Promise<void>;
    dispatchError(client: Client, error: unknown): Promise<void>;
    dispatchLifecycle(event: LifecycleEvent, client: Client): Promise<void>;
}
export {};
