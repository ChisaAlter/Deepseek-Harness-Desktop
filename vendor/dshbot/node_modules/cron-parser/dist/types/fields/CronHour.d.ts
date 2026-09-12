import { CronField, CronFieldOptions } from './CronField';
import { CronChars, CronMax, CronMin, HourRange } from './types';
/**
 * Represents the "hour" field within a cron expression.
 * @class CronHour
 * @extends CronField
 */
export declare class CronHour extends CronField {
    static get min(): CronMin;
    static get max(): CronMax;
    static get chars(): readonly CronChars[];
    /**
     * CronHour constructor. Initializes the "hour" field with the provided values.
     * @param {HourRange[]} values - Values for the "hour" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     */
    constructor(values: HourRange[], options?: CronFieldOptions);
    /**
     * Returns an array of allowed values for the "hour" field.
     * @returns {HourRange[]}
     */
    get values(): HourRange[];
}
