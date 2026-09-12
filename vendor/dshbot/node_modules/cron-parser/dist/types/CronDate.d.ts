export declare enum TimeUnit {
    Second = "Second",
    Minute = "Minute",
    Hour = "Hour",
    Day = "Day",
    Month = "Month",
    Year = "Year"
}
export declare enum DateMathOp {
    Add = "Add",
    Subtract = "Subtract"
}
export declare const DAYS_IN_MONTH: readonly number[];
/**
 * CronDate class that wraps the Luxon DateTime object to provide
 * a consistent API for working with dates and times in the context of cron.
 */
export declare class CronDate {
    #private;
    /**
     * Constructs a new CronDate instance.
     * @param {CronDate | Date | number | string} [timestamp] - The timestamp to initialize the CronDate with.
     * @param {string} [tz] - The timezone to use for the CronDate.
     */
    constructor(timestamp?: CronDate | Date | number | string, tz?: string);
    /**
     * Returns daylight savings start time.
     * @returns {number | null}
     */
    get dstStart(): number | null;
    /**
     * Returns the first existing hour after the skipped window, or null.
     * @returns {number | null}
     */
    get dstStartLandingHour(): number | null;
    /**
     * Discards the recorded daylight savings start window. The two halves are
     * only meaningful together, so neither is writable on its own.
     */
    clearDstStart(): void;
    /**
     * Returns daylight savings end time.
     * @returns {number | null}
     */
    get dstEnd(): number | null;
    /**
     * Sets daylight savings end time.
     * @param {number | null} value
     */
    set dstEnd(value: number | null);
    /**
     * Adds one year to the current CronDate.
     */
    addYear(): void;
    /**
     * Adds one month to the current CronDate.
     */
    addMonth(): void;
    /**
     * Adds one day to the current CronDate.
     */
    addDay(): void;
    /**
     * Adds one hour to the current CronDate.
     */
    addHour(): void;
    /**
     * Adds one minute to the current CronDate.
     */
    addMinute(): void;
    /**
     * Adds one second to the current CronDate.
     */
    addSecond(): void;
    /**
     * Subtracts one year from the current CronDate.
     */
    subtractYear(): void;
    /**
     * Subtracts one month from the current CronDate.
     * If the month is 1, it will subtract one year instead.
     */
    subtractMonth(): void;
    /**
     * Subtracts one day from the current CronDate.
     * If the day is 1, it will subtract one month instead.
     */
    subtractDay(): void;
    /**
     * Subtracts one hour from the current CronDate.
     * If the hour is 0, it will subtract one day instead.
     */
    subtractHour(): void;
    /**
     * Subtracts one minute from the current CronDate.
     * If the minute is 0, it will subtract one hour instead.
     */
    subtractMinute(): void;
    /**
     * Subtracts one second from the current CronDate.
     * If the second is 0, it will subtract one minute instead.
     */
    subtractSecond(): void;
    /**
     * Adds a unit of time to the current CronDate.
     * @param {TimeUnit} unit
     */
    addUnit(unit: TimeUnit): void;
    /**
     * Subtracts a unit of time from the current CronDate.
     * @param {TimeUnit} unit
     */
    subtractUnit(unit: TimeUnit): void;
    /**
     * Handles a math operation.
     * @param {DateMathOp} verb - {'add' | 'subtract'}
     * @param {TimeUnit} unit - {'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'}
     */
    invokeDateOperation(verb: DateMathOp, unit: TimeUnit): void;
    /**
     * Returns the day.
     * @returns {number}
     */
    getDate(): number;
    /**
     * Returns the year.
     * @returns {number}
     */
    getFullYear(): number;
    /**
     * Returns the day of the week.
     * @returns {number}
     */
    getDay(): number;
    /**
     * Returns the month.
     * @returns {number}
     */
    getMonth(): number;
    /**
     * Returns the hour.
     * @returns {number}
     */
    getHours(): number;
    /**
     * Returns the minutes.
     * @returns {number}
     */
    getMinutes(): number;
    /**
     * Returns the seconds.
     * @returns {number}
     */
    getSeconds(): number;
    /**
     * Returns the milliseconds.
     * @returns {number}
     */
    getMilliseconds(): number;
    /**
     * Returns the timezone offset from UTC in minutes (e.g. UTC+2 => 120).
     * Useful for detecting DST transition days.
     *
     * @returns {number} UTC offset in minutes
     */
    getUTCOffset(): number;
    /**
     * Sets the time to the start of the day (00:00:00.000) in the current timezone.
     */
    setStartOfDay(): void;
    /**
     * Sets the time to the end of the day (23:59:59.999) in the current timezone.
     */
    setEndOfDay(): void;
    /**
     * Returns the time.
     * @returns {number}
     */
    getTime(): number;
    /**
     * Returns the UTC day.
     * @returns {number}
     */
    getUTCDate(): number;
    /**
     * Returns the UTC year.
     * @returns {number}
     */
    getUTCFullYear(): number;
    /**
     * Returns the UTC day of the week.
     * @returns {number}
     */
    getUTCDay(): number;
    /**
     * Returns the UTC month.
     * @returns {number}
     */
    getUTCMonth(): number;
    /**
     * Returns the UTC hour.
     * @returns {number}
     */
    getUTCHours(): number;
    /**
     * Returns the UTC minutes.
     * @returns {number}
     */
    getUTCMinutes(): number;
    /**
     * Returns the UTC seconds.
     * @returns {number}
     */
    getUTCSeconds(): number;
    /**
     * Returns the UTC milliseconds.
     * @returns {string | null}
     */
    toISOString(): string | null;
    /**
     * Returns the date as a JSON string.
     * @returns {string | null}
     */
    toJSON(): string | null;
    /**
     * Sets the day.
     * @param d
     */
    setDate(d: number): void;
    /**
     * Sets the year.
     * @param y
     */
    setFullYear(y: number): void;
    /**
     * Sets the day of the week.
     * @param d
     */
    setDay(d: number): void;
    /**
     * Sets the month.
     * @param m
     */
    setMonth(m: number): void;
    /**
     * Sets the hour.
     * @param h
     */
    setHours(h: number): void;
    /**
     * Sets the minutes.
     * @param m
     */
    setMinutes(m: number): void;
    /**
     * Sets the seconds.
     * @param s
     */
    setSeconds(s: number): void;
    /**
     * Sets the milliseconds.
     * @param s
     */
    setMilliseconds(s: number): void;
    /**
     * Returns the date as a string.
     * @returns {string}
     */
    toString(): string;
    /**
     * Returns the date as a Date object.
     * @returns {Date}
     */
    toDate(): Date;
    /**
     * Returns true if the day is the last day of the month.
     * @returns {boolean}
     */
    isLastDayOfMonth(): boolean;
    /**
     * Returns true if the day is the last weekday of the month.
     * @returns {boolean}
     */
    isLastWeekdayOfMonth(): boolean;
    /**
     * Primarily for internal use.
     * @param {DateMathOp} op - The operation to perform.
     * @param {TimeUnit} unit - The unit of time to use.
     * @param {number} [hoursLength] - The length of the hours. Required when unit is not month or day.
     */
    applyDateOperation(op: DateMathOp, unit: TimeUnit, hoursLength?: number): void;
}
export default CronDate;
