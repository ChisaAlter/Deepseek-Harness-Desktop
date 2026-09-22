import { CronField, CronFieldOptions } from './CronField';
import { CronChars, CronMax, CronMin, SixtyRange } from './types';
/**
 * Represents the "second" field within a cron expression.
 * @class CronSecond
 * @extends CronField
 */
export declare class CronMinute extends CronField {
    static get min(): CronMin;
    static get max(): CronMax;
    static get chars(): readonly CronChars[];
    /**
     * CronSecond constructor. Initializes the "second" field with the provided values.
     * @param {SixtyRange[]} values - Values for the "second" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     */
    constructor(values: SixtyRange[], options?: CronFieldOptions);
    /**
     * Returns an array of allowed values for the "second" field.
     * @returns {SixtyRange[]}
     */
    get values(): SixtyRange[];
}
