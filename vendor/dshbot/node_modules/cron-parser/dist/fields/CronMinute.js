"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronMinute = void 0;
const CronField_1 = require("./CronField");
const MIN_MINUTE = 0;
const MAX_MINUTE = 59;
const MINUTE_CHARS = Object.freeze([]);
/**
 * Represents the "second" field within a cron expression.
 * @class CronSecond
 * @extends CronField
 */
class CronMinute extends CronField_1.CronField {
    static get min() {
        return MIN_MINUTE;
    }
    static get max() {
        return MAX_MINUTE;
    }
    static get chars() {
        return MINUTE_CHARS;
    }
    /**
     * CronSecond constructor. Initializes the "second" field with the provided values.
     * @param {SixtyRange[]} values - Values for the "second" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     */
    constructor(values, options) {
        super(values, options);
        this.validate();
    }
    /**
     * Returns an array of allowed values for the "second" field.
     * @returns {SixtyRange[]}
     */
    get values() {
        return super.values;
    }
}
exports.CronMinute = CronMinute;
