export interface GrpcConnectionOptions {
    baseUrl?: string;
    origin?: string;
    appVersion?: string;
    browserType?: string;
    browserVersion?: string;
    osType?: string;
    userAgent?: string;
}
export declare class BaleGrpcConnection {
    readonly baseUrl: string;
    readonly origin: string;
    readonly appVersion: string;
    readonly browserType: string;
    readonly browserVersion: string;
    readonly osType: string;
    readonly userAgent: string;
    readonly sessionId: string;
    private readonly baseHeaders;
    private client?;
    constructor(options?: GrpcConnectionOptions);
    close(): void;
    request<TResponse>(service: string, requestType: string, responseType: string, payload: object): Promise<TResponse>;
    private getClient;
}
