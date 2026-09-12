import { CronField, CronFieldOptions } from './CronField';
import { CronChars, CronMax, CronMin, MonthRange } from './types';
/**
 * Represents the "day of the month" field within a cron expression.
 * @class CronDayOfMonth
 * @extends CronField
 */
export declare class CronMonth extends CronField {
    static get min(): CronMin;
    static get max(): CronMax;
    static get chars(): readonly CronChars[];
    static get daysInMonth(): readonly number[];
    /**
     * CronDayOfMonth constructor. Initializes the "day of the month" field with the provided values.
     * @param {MonthRange[]} values - Values for the "day of the month" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     */
    constructor(values: MonthRange[], options?: CronFieldOptions);
    /**
     * Returns an array of allowed values for the "day of the month" field.
     * @returns {MonthRange[]}
     */
    get values(): MonthRange[];
}
