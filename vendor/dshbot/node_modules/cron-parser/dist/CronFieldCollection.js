"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronFieldCollection = void 0;
const fields_1 = require("./fields");
/**
 * Represents a complete set of cron fields.
 * @class CronFieldCollection
 */
class CronFieldCollection {
    #second;
    #minute;
    #hour;
    #dayOfMonth;
    #month;
    #dayOfWeek;
    /**
     * Creates a new CronFieldCollection instance by partially overriding fields from an existing one.
     * @param {CronFieldCollection} base - The base CronFieldCollection to copy fields from
     * @param {CronFieldOverride} fields - The fields to override, can be CronField instances or raw values
     * @returns {CronFieldCollection} A new CronFieldCollection instance
     * @example
     * const base = new CronFieldCollection({
     *   second: new CronSecond([0]),
     *   minute: new CronMinute([0]),
     *   hour: new CronHour([12]),
     *   dayOfMonth: new CronDayOfMonth([1]),
     *   month: new CronMonth([1]),
     *   dayOfWeek: new CronDayOfWeek([1])
     * });
     *
     * // Using CronField instances
     * const modified1 = CronFieldCollection.from(base, {
     *   hour: new CronHour([15]),
     *   minute: new CronMinute([30])
     * });
     *
     * // Using raw values
     * const modified2 = CronFieldCollection.from(base, {
     *   hour: [15],        // Will create new CronHour
     *   minute: [30]       // Will create new CronMinute
     * });
     */
    static from(base, fields) {
        return new CronFieldCollection({
            second: this.resolveField(fields_1.CronSecond, base.second, fields.second),
            minute: this.resolveField(fields_1.CronMinute, base.minute, fields.minute),
            hour: this.resolveField(fields_1.CronHour, base.hour, fields.hour),
            dayOfMonth: this.resolveField(fields_1.CronDayOfMonth, base.dayOfMonth, fields.dayOfMonth),
            month: this.resolveField(fields_1.CronMonth, base.month, fields.month),
            dayOfWeek: this.resolveField(fields_1.CronDayOfWeek, base.dayOfWeek, fields.dayOfWeek),
        });
    }
    /**
     * Resolves a field value, either using the provided CronField instance or creating a new one from raw values.
     * @param constructor - The constructor for creating new field instances
     * @param baseField - The base field to use if no override is provided
     * @param fieldValue - The override value, either a CronField instance or raw values
     * @returns The resolved CronField instance
     * @private
     */
    static resolveField(constructor, baseField, fieldValue) {
        if (!fieldValue) {
            return baseField;
        }
        if (fieldValue instanceof fields_1.CronField) {
            return fieldValue;
        }
        return new constructor(fieldValue);
    }
    /**
     * CronFieldCollection constructor. Initializes the cron fields with the provided values.
     * @param {CronFields} param0 - The cron fields values
     * @throws {Error} if validation fails
     * @example
     * const cronFields = new CronFieldCollection({
     *   second: new CronSecond([0]),
     *   minute: new CronMinute([0, 30]),
     *   hour: new CronHour([9]),
     *   dayOfMonth: new CronDayOfMonth([15]),
     *   month: new CronMonth([1]),
     *   dayOfWeek: new CronDayOfTheWeek([1, 2, 3, 4, 5]),
     * })
     *
     * console.log(cronFields.second.values); // [0]
     * console.log(cronFields.minute.values); // [0, 30]
     * console.log(cronFields.hour.values); // [9]
     * console.log(cronFields.dayOfMonth.values); // [15]
     * console.log(cronFields.month.values); // [1]
     * console.log(cronFields.dayOfWeek.values); // [1, 2, 3, 4, 5]
     */
    constructor({ second, minute, hour, dayOfMonth, month, dayOfWeek }) {
        if (!second) {
            throw new Error('Validation error, Field second is missing');
        }
        if (!minute) {
            throw new Error('Validation error, Field minute is missing');
        }
        if (!hour) {
            throw new Error('Validation error, Field hour is missing');
        }
        if (!dayOfMonth) {
            throw new Error('Validation error, Field dayOfMonth is missing');
        }
        if (!month) {
            throw new Error('Validation error, Field month is missing');
        }
        if (!dayOfWeek) {
            throw new Error('Validation error, Field dayOfWeek is missing');
        }
        // Only an explicit day of month that can never occur is invalid. When the
        // day of week is restricted it rescues the expression (day of month and day
        // of week combine with OR), so the day of month need not be reachable.
        if (month.values.length === 1 && !dayOfMonth.hasLastChar && dayOfWeek.isWildcard) {
            if (!(parseInt(dayOfMonth.values[0], 10) <= fields_1.CronMonth.daysInMonth[month.values[0] - 1])) {
                throw new Error('Invalid explicit day of month definition');
            }
        }
        this.#second = second;
        this.#minute = minute;
        this.#hour = hour;
        this.#month = month;
        this.#dayOfWeek = dayOfWeek;
        this.#dayOfMonth = dayOfMonth;
    }
    /**
     * Returns the second field.
     * @returns {CronSecond}
     */
    get second() {
        return this.#second;
    }
    /**
     * Returns the minute field.
     * @returns {CronMinute}
     */
    get minute() {
        return this.#minute;
    }
    /**
     * Returns the hour field.
     * @returns {CronHour}
     */
    get hour() {
        return this.#hour;
    }
    /**
     * Returns the day of the month field.
     * @returns {CronDayOfMonth}
     */
    get dayOfMonth() {
        return this.#dayOfMonth;
    }
    /**
     * Returns the month field.
     * @returns {CronMonth}
     */
    get month() {
        return this.#month;
    }
    /**
     * Returns the day of the week field.
     * @returns {CronDayOfWeek}
     */
    get dayOfWeek() {
        return this.#dayOfWeek;
    }
    /**
     * Returns a string representation of the cron fields.
     * @param {(number | CronChars)[]} input - The cron fields values
     * @static
     * @returns {FieldRange[]} - The compacted cron fields
     */
    static compactField(input) {
        if (input.length === 0) {
            return [];
        }
        // Initialize the output array and current IFieldRange
        const output = [];
        let current = undefined;
        input.forEach((item, i, arr) => {
            // If the current FieldRange is undefined, create a new one with the current item as the start.
            if (current === undefined) {
                current = { start: item, count: 1 };
                return;
            }
            // Cache the previous and next items in the array.
            const prevItem = arr[i - 1] || current.start;
            const nextItem = arr[i + 1];
            // If the current item is 'L' or 'W', push the current FieldRange to the output and
            // create a new FieldRange with the current item as the start.
            // 'L' and 'W' characters are special cases that need to be handled separately.
            if (item === 'L' || item === 'W') {
                output.push(current);
                output.push({ start: item, count: 1 });
                current = undefined;
                return;
            }
            // If the current step is undefined and there is a next item, update the current IFieldRange.
            // This block checks if the current step needs to be updated and does so if needed.
            if (current.step === undefined && nextItem !== undefined) {
                const step = item - prevItem;
                const nextStep = nextItem - item;
                // If the current step is less or equal to the next step, update the current FieldRange to include the current item.
                if (step <= nextStep) {
                    current = { ...current, count: 2, end: item, step };
                    return;
                }
                current.step = 1;
            }
            // If the difference between the current item and the current end is equal to the current step,
            // update the current IFieldRange's count and end.
            // This block checks if the current item is part of the current range and updates the range accordingly.
            if (item - (current.end ?? 0) === current.step) {
                current.count++;
                current.end = item;
            }
            else {
                // If the count is 1, push a new FieldRange with the current start.
                // This handles the case where the current range has only one element.
                if (current.count === 1) {
                    // If the count is 2, push two separate IFieldRanges, one for each element.
                    output.push({ start: current.start, count: 1 });
                }
                else if (current.count === 2) {
                    output.push({ start: current.start, count: 1 });
                    // current.end can never be undefined here but typescript doesn't know that
                    // this is why we ?? it and then ignore the prevItem in the coverage
                    output.push({
                        start: current.end ?? /* istanbul ignore next - see above */ prevItem,
                        count: 1,
                    });
                }
                else {
                    // Otherwise, push the current FieldRange to the output.
                    output.push(current);
                }
                // Reset the current FieldRange with the current item as the start.
                current = { start: item, count: 1 };
            }
        });
        // Push the final IFieldRange, if any, to the output array.
        if (current) {
            output.push(current);
        }
        return output;
    }
    /**
     * Handles a single range.
     * @param {CronField} field - The cron field to stringify
     * @param {FieldRange} range {start: number, end: number, step: number, count: number} The range to handle.
     * @param {number} max The maximum value for the field.
     * @returns {string | null} The stringified range or null if it cannot be stringified.
     * @private
     */
    static #handleSingleRange(field, range, max) {
        const step = range.step;
        if (!step) {
            return null;
        }
        if (step === 1 && range.start === field.min && range.end && range.end >= max) {
            const isDayField = field instanceof fields_1.CronDayOfMonth || field instanceof fields_1.CronDayOfWeek;
            if (isDayField && !field.isWildcard) {
                return null;
            }
            return field.hasQuestionMarkChar ? '?' : '*';
        }
        if (step !== 1 && range.start === field.min && range.end && range.end >= max - step + 1) {
            return `*/${step}`;
        }
        return null;
    }
    /**
     * Handles multiple ranges.
     * @param {FieldRange} range {start: number, end: number, step: number, count: number} The range to handle.
     * @returns {string} The stringified range.
     * @private
     */
    static #handleMultipleRanges(range) {
        const step = range.step;
        if (step === 1) {
            return `${range.start}-${range.end}`;
        }
        const multiplier = range.start === 0 ? range.count - 1 : range.count;
        /* istanbul ignore if */
        if (!step) {
            throw new Error('Unexpected range step');
        }
        /* istanbul ignore if */
        if (!range.end) {
            throw new Error('Unexpected range end');
        }
        if (step * multiplier > range.end) {
            const mapFn = (_, index) => {
                /* istanbul ignore if */
                if (typeof range.start !== 'number') {
                    throw new Error('Unexpected range start');
                }
                return index % step === 0 ? range.start + index : null;
            };
            /* istanbul ignore if */
            if (typeof range.start !== 'number') {
                throw new Error('Unexpected range start');
            }
            const seed = { length: range.end - range.start + 1 };
            return Array.from(seed, mapFn)
                .filter((value) => value !== null)
                .join(',');
        }
        return `${range.start}-${range.end}/${step}`;
    }
    /**
     * Returns a string representation of the cron fields.
     * @param {CronField} field - The cron field to stringify
     * @static
     * @returns {string} - The stringified cron field
     */
    stringifyField(field) {
        let max = field.max;
        let values = field.values;
        if (field instanceof fields_1.CronDayOfWeek) {
            max = 6;
            const dayOfWeek = this.#dayOfWeek.values;
            values = dayOfWeek[dayOfWeek.length - 1] === 7 ? dayOfWeek.slice(0, -1) : dayOfWeek;
        }
        if (field instanceof fields_1.CronDayOfMonth) {
            max = this.#month.values.length === 1 ? fields_1.CronMonth.daysInMonth[this.#month.values[0] - 1] : field.max;
        }
        const ranges = CronFieldCollection.compactField(values);
        if (ranges.length === 1) {
            const singleRangeResult = CronFieldCollection.#handleSingleRange(field, ranges[0], max);
            if (singleRangeResult) {
                return singleRangeResult;
            }
        }
        return ranges
            .map((range) => {
            const value = range.count === 1 ? range.start.toString() : CronFieldCollection.#handleMultipleRanges(range);
            if (field instanceof fields_1.CronDayOfWeek && field.nthDay > 0) {
                return `${value}#${field.nthDay}`;
            }
            return value;
        })
            .join(',');
    }
    /**
     * Returns a string representation of the cron field values.
     * @param {boolean} includeSeconds - Whether to include seconds in the output
     * @returns {string} The formatted cron string
     */
    stringify(includeSeconds = false) {
        const arr = [];
        if (includeSeconds) {
            arr.push(this.stringifyField(this.#second)); // second
        }
        arr.push(this.stringifyField(this.#minute), // minute
        this.stringifyField(this.#hour), // hour
        this.stringifyField(this.#dayOfMonth), // dayOfMonth
        this.stringifyField(this.#month), // month
        this.stringifyField(this.#dayOfWeek));
        return arr.join(' ');
    }
    /**
     * Returns a serialized representation of the cron fields values.
     * @returns {SerializedCronFields} An object containing the cron field values
     */
    serialize() {
        return {
            second: this.#second.serialize(),
            minute: this.#minute.serialize(),
            hour: this.#hour.serialize(),
            dayOfMonth: this.#dayOfMonth.serialize(),
            month: this.#month.serialize(),
            dayOfWeek: this.#dayOfWeek.serialize(),
        };
    }
}
exports.CronFieldCollection = CronFieldCollection;
