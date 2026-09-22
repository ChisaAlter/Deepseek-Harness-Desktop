"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronHour = void 0;
const CronField_1 = require("./CronField");
const MIN_HOUR = 0;
const MAX_HOUR = 23;
const HOUR_CHARS = Object.freeze([]);
/**
 * Represents the "hour" field within a cron expression.
 * @class CronHour
 * @extends CronField
 */
class CronHour extends CronField_1.CronField {
    static get min() {
        return MIN_HOUR;
    }
    static get max() {
        return MAX_HOUR;
    }
    static get chars() {
        return HOUR_CHARS;
    }
    /**
     * CronHour constructor. Initializes the "hour" field with the provided values.
     * @param {HourRange[]} values - Values for the "hour" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     */
    constructor(values, options) {
        super(values, options);
        this.validate();
    }
    /**
     * Returns an array of allowed values for the "hour" field.
     * @returns {HourRange[]}
     */
    get values() {
        return super.values;
    }
}
exports.CronHour = CronHour;
