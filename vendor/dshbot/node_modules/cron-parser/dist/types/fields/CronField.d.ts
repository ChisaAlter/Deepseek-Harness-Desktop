import { CronChars, CronConstraints, CronFieldType, CronMax, CronMin } from './types';
/**
 * Represents the serialized form of a cron field.
 * @typedef {Object} SerializedCronField
 * @property {boolean} wildcard - Indicates if the field is a wildcard.
 * @property {(number|string)[]} values - The values of the field.
 */
export type SerializedCronField = {
    wildcard: boolean;
    values: (number | string)[];
};
/**
 * Represents the options for a cron field.
 * @typedef {Object} CronFieldOptions
 * @property {string} rawValue - The raw value of the field.
 * @property {boolean} [wildcard] - Indicates if the field is a wildcard.
 * @property {number} [nthDayOfWeek] - The nth day of the week.
 */
export type CronFieldOptions = {
    rawValue?: string;
    wildcard?: boolean;
    nthDayOfWeek?: number;
};
/**
 * Represents a field within a cron expression.
 * This is a base class and should not be instantiated directly.
 * @class CronField
 */
export declare abstract class CronField {
    #private;
    protected readonly options: CronFieldOptions & {
        rawValue: string;
    };
    /**
     * Returns the minimum value allowed for this field.
     */
    static get min(): CronMin;
    /**
     * Returns the maximum value allowed for this field.
     */
    static get max(): CronMax;
    /**
     * Returns the allowed characters for this field.
     */
    static get chars(): readonly CronChars[];
    /**
     * Returns the regular expression used to validate this field.
     */
    static get validChars(): RegExp;
    /**
     * Returns the constraints for this field.
     */
    static get constraints(): CronConstraints;
    /**
     * CronField constructor. Initializes the field with the provided values.
     * @param {number[] | string[]} values - Values for this field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     * @throws {TypeError} if the constructor is called directly
     * @throws {Error} if validation fails
     */
    protected constructor(values: (number | string)[], options?: CronFieldOptions);
    /**
     * Returns the minimum value allowed for this field.
     * @returns {number}
     */
    get min(): number;
    /**
     * Returns the maximum value allowed for this field.
     * @returns {number}
     */
    get max(): number;
    /**
     * Returns an array of allowed special characters for this field.
     * @returns {string[]}
     */
    get chars(): readonly string[];
    /**
     * Indicates whether this field has a "last" character.
     * @returns {boolean}
     */
    get hasLastChar(): boolean;
    /**
     * Indicates whether this field has a "question mark" character.
     * @returns {boolean}
     */
    get hasQuestionMarkChar(): boolean;
    /**
     * Indicates whether this field is a wildcard.
     * @returns {boolean}
     */
    get isWildcard(): boolean;
    /**
     * Returns an array of allowed values for this field.
     * @returns {CronFieldType}
     */
    get values(): CronFieldType;
    /**
     * Helper function to sort values in ascending order.
     * @param {number | string} a - First value to compare
     * @param {number | string} b - Second value to compare
     * @returns {number} - A negative, zero, or positive value, depending on the sort order
     */
    static sorter(a: number | string, b: number | string): number;
    /**
     * Find the next (or previous when `reverse` is true) numeric value in a sorted list.
     * Returns null if there's no value strictly after/before the current one.
     *
     * @param values - Sorted numeric values
     * @param currentValue - Current value to compare against
     * @param reverse - When true, search in reverse for previous smaller value
     */
    static findNearestValueInList(values: number[], currentValue: number, reverse: boolean): number | null;
    /**
     * Instance helper that operates on this field's numeric `values`.
     *
     * @param currentValue - Current value to compare against
     * @param reverse - When true, search in reverse for previous smaller value
     */
    findNearestValue(currentValue: number, reverse: boolean): number | null;
    /**
     * Serializes the field to an object.
     * @returns {SerializedCronField}
     */
    serialize(): SerializedCronField;
    /**
     * Validates the field values against the allowed range and special characters.
     * @throws {Error} if validation fails
     */
    validate(): void;
}
