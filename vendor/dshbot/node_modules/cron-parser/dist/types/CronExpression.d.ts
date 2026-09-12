import { CronDate } from './CronDate';
import { CronFieldCollection } from './CronFieldCollection';
export type CronExpressionOptions = {
    currentDate?: Date | string | number | CronDate;
    endDate?: Date | string | number | CronDate;
    startDate?: Date | string | number | CronDate;
    tz?: string;
    expression?: string;
    hashSeed?: string;
    strict?: boolean;
};
/**
 * Error message for when the current date is outside the specified time span.
 */
export declare const TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE = "Out of the time span range";
/**
 * Error message for when the loop limit is exceeded during iteration.
 */
export declare const LOOPS_LIMIT_EXCEEDED_ERROR_MESSAGE = "Invalid expression, loop limit exceeded";
/**
 * Class representing a Cron expression.
 */
export declare class CronExpression {
    #private;
    /**
     * Creates a new CronExpression instance.
     *
     * @param {CronFieldCollection} fields - Cron fields.
     * @param {CronExpressionOptions} options - Parser options.
     */
    constructor(fields: CronFieldCollection, options: CronExpressionOptions);
    /**
     * Getter for the cron fields.
     *
     * @returns {CronFieldCollection} Cron fields.
     */
    get fields(): CronFieldCollection;
    /**
     * Converts cron fields back to a CronExpression instance.
     *
     * @public
     * @param {Record<string, number[]>} fields - The input cron fields object.
     * @param {CronExpressionOptions} [options] - Optional parsing options.
     * @returns {CronExpression} - A new CronExpression instance.
     */
    static fieldsToExpression(fields: CronFieldCollection, options?: CronExpressionOptions): CronExpression;
    /**
     * Find the next scheduled date based on the cron expression.
     * @returns {CronDate} - The next scheduled date or an ES6 compatible iterator object.
     * @memberof CronExpression
     * @public
     */
    next(): CronDate;
    /**
     * Find the previous scheduled date based on the cron expression.
     * @returns {CronDate} - The previous scheduled date or an ES6 compatible iterator object.
     * @memberof CronExpression
     * @public
     */
    prev(): CronDate;
    /**
     * Check if there is a next scheduled date based on the current date and cron expression.
     * @returns {boolean} - Returns true if there is a next scheduled date, false otherwise.
     * @memberof CronExpression
     * @public
     */
    hasNext(): boolean;
    /**
     * Check if there is a previous scheduled date based on the current date and cron expression.
     * @returns {boolean} - Returns true if there is a previous scheduled date, false otherwise.
     * @memberof CronExpression
     * @public
     */
    hasPrev(): boolean;
    /**
     * Iterate over a specified number of steps and optionally execute a callback function for each step.
     * @param {number} steps - The number of steps to iterate. Positive value iterates forward, negative value iterates backward.
     * @returns {CronDate[]} - An array of iterator fields or CronDate objects.
     * @memberof CronExpression
     * @public
     */
    take(limit: number): CronDate[];
    /**
     * Reset the iterators current date to a new date or the initial date.
     * @param {Date | CronDate} [newDate] - Optional new date to reset to. If not provided, it will reset to the initial date.
     * @memberof CronExpression
     * @public
     */
    reset(newDate?: Date | CronDate): void;
    /**
     * Generate a string representation of the cron expression.
     * @param {boolean} [includeSeconds=false] - Whether to include the seconds field in the string representation.
     * @returns {string} - The string representation of the cron expression.
     * @memberof CronExpression
     * @public
     */
    stringify(includeSeconds?: boolean): string;
    /**
     * Check if the cron expression includes the given date
     * @param {Date|CronDate} date
     * @returns {boolean}
     */
    includesDate(date: Date | CronDate): boolean;
    /**
     * Returns the string representation of the cron expression.
     * @returns {CronDate} - The next schedule date.
     */
    toString(): string;
    /**
     * Returns an iterator for iterating through future CronDate instances
     *
     * @name Symbol.iterator
     * @memberof CronExpression
     * @returns {Iterator<CronDate>} An iterator object for CronExpression that returns CronDate values.
     */
    [Symbol.iterator](): Iterator<CronDate>;
}
export default CronExpression;
