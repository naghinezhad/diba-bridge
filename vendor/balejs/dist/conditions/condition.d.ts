import type { Client } from "../client";
type MaybePromise<T> = T | Promise<T>;
export type ConditionPredicate<TEvent> = (client: Client, event: TEvent) => MaybePromise<boolean>;
export declare class Condition<TEvent> {
    readonly label: string;
    private readonly predicate;
    constructor(predicate: ConditionPredicate<TEvent>, label?: string);
    matches(client: Client, event: TEvent): Promise<boolean>;
    and(other: Condition<TEvent>): Condition<TEvent>;
    or(other: Condition<TEvent>): Condition<TEvent>;
    not(): Condition<TEvent>;
}
export declare function create<TEvent>(predicate: ConditionPredicate<TEvent>, label?: string): Condition<TEvent>;
export declare function all<TEvent>(...conditions: Condition<TEvent>[]): Condition<TEvent>;
export declare function any<TEvent>(...conditions: Condition<TEvent>[]): Condition<TEvent>;
export declare function not<TEvent>(condition: Condition<TEvent>): Condition<TEvent>;
export {};
