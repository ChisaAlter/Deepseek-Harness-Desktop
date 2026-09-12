import { CronField, CronFieldOptions } from './CronField';
import { CronChars, CronMax, CronMin, DayOfWeekRange } from './types';
/**
 * Represents the "day of the week" field within a cron expression.
 * @class CronDayOfTheWeek
 * @extends CronField
 */
export declare class CronDayOfWeek extends CronField {
    static get min(): CronMin;
    static get max(): CronMax;
    static get chars(): readonly CronChars[];
    static get validChars(): RegExp;
    /**
     * CronDayOfTheWeek constructor. Initializes the "day of the week" field with the provided values.
     * @param {DayOfWeekRange[]} values - Values for the "day of the week" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     */
    constructor(values: DayOfWeekRange[], options?: CronFieldOptions);
    /**
     * Returns an array of allowed values for the "day of the week" field.
     * @returns {DayOfWeekRange[]}
     */
    get values(): DayOfWeekRange[];
    /**
     * Returns the nth day of the week if specified in the cron expression.
     * This is used for the '#' character in the cron expression.
     * @returns {number} The nth day of the week (1-5) or 0 if not specified.
     */
    get nthDay(): number;
}
