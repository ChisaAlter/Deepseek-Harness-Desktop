import { CronField, CronFieldOptions } from './CronField';
import { CronChars, CronMax, CronMin, DayOfMonthRange, MonthRange } from './types';
/**
 * Represents the "day of the month" field within a cron expression.
 * @class CronDayOfMonth
 * @extends CronField
 */
export declare class CronDayOfMonth extends CronField {
    /**
     * Creates a "day of the month" field limited to the days the given month has.
     * @param {MonthRange[]} month - Values for the "month" field the days are used with
     * @param {DayOfMonthRange[]} values - Values for the "day of the month" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     * @returns {CronDayOfMonth}
     */
    static fromMonth(month: MonthRange[], values: DayOfMonthRange[], options?: CronFieldOptions): CronDayOfMonth;
    static get min(): CronMin;
    static get max(): CronMax;
    static get chars(): CronChars[];
    static get validChars(): RegExp;
    /**
     * CronDayOfMonth constructor. Initializes the "day of the month" field with the provided values.
     * @param {DayOfMonthRange[]} values - Values for the "day of the month" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     * @throws {Error} if validation fails
     */
    constructor(values: DayOfMonthRange[], options?: CronFieldOptions);
    /**
     * Returns an array of allowed values for the "day of the month" field.
     * @returns {DayOfMonthRange[]}
     */
    get values(): DayOfMonthRange[];
}
