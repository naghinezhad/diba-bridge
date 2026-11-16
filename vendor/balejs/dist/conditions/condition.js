"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Condition = void 0;
exports.create = create;
exports.all = all;
exports.any = any;
exports.not = not;
class Condition {
    label;
    predicate;
    constructor(predicate, label = "Condition") {
        this.predicate = predicate;
        this.label = label;
    }
    async matches(client, event) {
        return await this.predicate(client, event);
    }
    and(other) {
        return new Condition(async (client, event) => {
            return (await this.matches(client, event)) && (await other.matches(client, event));
        }, `All(${this.label}, ${other.label})`);
    }
    or(other) {
        return new Condition(async (client, event) => {
            return (await this.matches(client, event)) || (await other.matches(client, event));
        }, `Any(${this.label}, ${other.label})`);
    }
    not() {
        return new Condition(async (client, event) => {
            return !(await this.matches(client, event));
        }, `Not(${this.label})`);
    }
}
exports.Condition = Condition;
function create(predicate, label) {
    return new Condition(predicate, label);
}
function all(...conditions) {
    return new Condition(async (client, event) => {
        for (const condition of conditions) {
            if (!(await condition.matches(client, event))) {
                return false;
            }
        }
        return true;
    }, `All(${conditions.map((condition) => condition.label).join(", ")})`);
}
function any(...conditions) {
    return new Condition(async (client, event) => {
        for (const condition of conditions) {
            if (await condition.matches(client, event)) {
                return true;
            }
        }
        return false;
    }, `Any(${conditions.map((condition) => condition.label).join(", ")})`);
}
function not(condition) {
    return condition.not();
}
