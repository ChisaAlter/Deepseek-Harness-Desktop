import { CronSecond, CronMinute, CronHour, CronDayOfMonth, CronMonth, CronDayOfWeek, CronField, SerializedCronField, CronChars } from './fields';
import { SixtyRange, HourRange, DayOfMonthRange, MonthRange, DayOfWeekRange } from './fields/types';
export type FieldRange = {
    start: number | CronChars;
    count: number;
    end?: number;
    step?: number;
};
export type CronFields = {
    second: CronSecond;
    minute: CronMinute;
    hour: CronHour;
    dayOfMonth: CronDayOfMonth;
    month: CronMonth;
    dayOfWeek: CronDayOfWeek;
};
export type CronFieldOverride = {
    second?: CronSecond | SixtyRange[];
    minute?: CronMinute | SixtyRange[];
    hour?: CronHour | HourRange[];
    dayOfMonth?: CronDayOfMonth | DayOfMonthRange[];
    month?: CronMonth | MonthRange[];
    dayOfWeek?: CronDayOfWeek | DayOfWeekRange[];
};
export type SerializedCronFields = {
    second: SerializedCronField;
    minute: SerializedCronField;
    hour: SerializedCronField;
    dayOfMonth: SerializedCronField;
    month: SerializedCronField;
    dayOfWeek: SerializedCronField;
};
/**
 * Represents a complete set of cron fields.
 * @class CronFieldCollection
 */
export declare class CronFieldCollection {
    #private;
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
    static from(base: CronFieldCollection, fields: CronFieldOverride): CronFieldCollection;
    /**
     * Resolves a field value, either using the provided CronField instance or creating a new one from raw values.
     * @param constructor - The constructor for creating new field instances
     * @param baseField - The base field to use if no override is provided
     * @param fieldValue - The override value, either a CronField instance or raw values
     * @returns The resolved CronField instance
     * @private
     */
    private static resolveField;
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
    constructor({ second, minute, hour, dayOfMonth, month, dayOfWeek }: CronFields);
    /**
     * Returns the second field.
     * @returns {CronSecond}
     */
    get second(): CronSecond;
    /**
     * Returns the minute field.
     * @returns {CronMinute}
     */
    get minute(): CronMinute;
    /**
     * Returns the hour field.
     * @returns {CronHour}
     */
    get hour(): CronHour;
    /**
     * Returns the day of the month field.
     * @returns {CronDayOfMonth}
     */
    get dayOfMonth(): CronDayOfMonth;
    /**
     * Returns the month field.
     * @returns {CronMonth}
     */
    get month(): CronMonth;
    /**
     * Returns the day of the week field.
     * @returns {CronDayOfWeek}
     */
    get dayOfWeek(): CronDayOfWeek;
    /**
     * Returns a string representation of the cron fields.
     * @param {(number | CronChars)[]} input - The cron fields values
     * @static
     * @returns {FieldRange[]} - The compacted cron fields
     */
    static compactField(input: (number | CronChars)[]): FieldRange[];
    /**
     * Returns a string representation of the cron fields.
     * @param {CronField} field - The cron field to stringify
     * @static
     * @returns {string} - The stringified cron field
     */
    stringifyField(field: CronField): string;
    /**
     * Returns a string representation of the cron field values.
     * @param {boolean} includeSeconds - Whether to include seconds in the output
     * @returns {string} The formatted cron string
     */
    stringify(includeSeconds?: boolean): string;
    /**
     * Returns a serialized representation of the cron fields values.
     * @returns {SerializedCronFields} An object containing the cron field values
     */
    serialize(): SerializedCronFields;
}
