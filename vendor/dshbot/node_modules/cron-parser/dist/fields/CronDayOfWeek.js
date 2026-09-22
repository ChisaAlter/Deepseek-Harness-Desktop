"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronDayOfWeek = void 0;
const CronField_1 = require("./CronField");
const MIN_DAY = 0;
const MAX_DAY = 7;
const DAY_CHARS = Object.freeze(['L']);
/**
 * Represents the "day of the week" field within a cron expression.
 * @class CronDayOfTheWeek
 * @extends CronField
 */
class CronDayOfWeek extends CronField_1.CronField {
    static get min() {
        return MIN_DAY;
    }
    static get max() {
        return MAX_DAY;
    }
    static get chars() {
        return DAY_CHARS;
    }
    static get validChars() {
        return /^[?,*\dLH#/-]+$|^.*H\(\d+-\d+\)\/\d+.*$|^.*H\(\d+-\d+\).*$|^.*H\/\d+.*$/;
    }
    /**
     * CronDayOfTheWeek constructor. Initializes the "day of the week" field with the provided values.
     * @param {DayOfWeekRange[]} values - Values for the "day of the week" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     */
    constructor(values, options) {
        super(values, options);
        this.validate();
        if (this.values.some((value) => value === 'L')) {
            throw new Error(`${this.constructor.name} Validation error, unexpected standalone L`);
        }
    }
    /**
     * Returns an array of allowed values for the "day of the week" field.
     * @returns {DayOfWeekRange[]}
     */
    get values() {
        return super.values;
    }
    /**
     * Returns the nth day of the week if specified in the cron expression.
     * This is used for the '#' character in the cron expression.
     * @returns {number} The nth day of the week (1-5) or 0 if not specified.
     */
    get nthDay() {
        return this.options.nthDayOfWeek ?? 0;
    }
}
exports.CronDayOfWeek = CronDayOfWeek;
