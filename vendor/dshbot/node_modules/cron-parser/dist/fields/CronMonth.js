"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronMonth = void 0;
const CronDate_1 = require("../CronDate");
const CronField_1 = require("./CronField");
const MIN_MONTH = 1;
const MAX_MONTH = 12;
const MONTH_CHARS = Object.freeze([]);
/**
 * Represents the "day of the month" field within a cron expression.
 * @class CronDayOfMonth
 * @extends CronField
 */
class CronMonth extends CronField_1.CronField {
    static get min() {
        return MIN_MONTH;
    }
    static get max() {
        return MAX_MONTH;
    }
    static get chars() {
        return MONTH_CHARS;
    }
    static get daysInMonth() {
        return CronDate_1.DAYS_IN_MONTH;
    }
    /**
     * CronDayOfMonth constructor. Initializes the "day of the month" field with the provided values.
     * @param {MonthRange[]} values - Values for the "day of the month" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     */
    constructor(values, options) {
        super(values, options);
        this.validate();
    }
    /**
     * Returns an array of allowed values for the "day of the month" field.
     * @returns {MonthRange[]}
     */
    get values() {
        return super.values;
    }
}
exports.CronMonth = CronMonth;
