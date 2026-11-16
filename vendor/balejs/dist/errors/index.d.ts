export declare class BaleRpcError extends Error {
    readonly code: number;
    readonly reason?: string;
    constructor(code: number, message: string, reason?: string);
}
export declare class AuthenticationError extends Error {
    constructor(message: string);
}
export declare class ClientStateError extends Error {
    constructor(message: string);
}
