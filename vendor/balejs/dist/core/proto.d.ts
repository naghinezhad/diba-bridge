import protobuf from "protobufjs";
declare const protoRoot: protobuf.Root;
export declare function encodeMessage(typeName: string, payload: object): Uint8Array;
export declare function decodeMessage<T>(typeName: string, payload: Uint8Array): T;
export { protoRoot };
