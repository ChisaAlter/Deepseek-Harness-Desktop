"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronDate = exports.DAYS_IN_MONTH = exports.DateMathOp = exports.TimeUnit = void 0;
const luxon_1 = require("luxon");
var TimeUnit;
(function (TimeUnit) {
    TimeUnit["Second"] = "Second";
    TimeUnit["Minute"] = "Minute";
    TimeUnit["Hour"] = "Hour";
    TimeUnit["Day"] = "Day";
    TimeUnit["Month"] = "Month";
    TimeUnit["Year"] = "Year";
})(TimeUnit || (exports.TimeUnit = TimeUnit = {}));
var DateMathOp;
(function (DateMathOp) {
    DateMathOp["Add"] = "Add";
    DateMathOp["Subtract"] = "Subtract";
})(DateMathOp || (exports.DateMathOp = DateMathOp = {}));
exports.DAYS_IN_MONTH = Object.freeze([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
/**
 * CronDate class that wraps the Luxon DateTime object to provide
 * a consistent API for working with dates and times in the context of cron.
 */
class CronDate {
    #date;
    #dstStart = null;
    #dstStartLandingHour = null;
    #dstEnd = null;
    /**
     * Constructs a new CronDate instance.
     * @param {CronDate | Date | number | string} [timestamp] - The timestamp to initialize the CronDate with.
     * @param {string} [tz] - The timezone to use for the CronDate.
     */
    constructor(timestamp, tz) {
        const dateOpts = { zone: tz };
        // Initialize the internal DateTime object based on the type of timestamp provided.
        if (!timestamp) {
            this.#date = luxon_1.DateTime.local();
        }
        else if (timestamp instanceof CronDate) {
            this.#date = timestamp.#date;
            this.#dstStart = timestamp.#dstStart;
            this.#dstStartLandingHour = timestamp.#dstStartLandingHour;
            this.#dstEnd = timestamp.#dstEnd;
        }
        else if (timestamp instanceof Date) {
            this.#date = luxon_1.DateTime.fromJSDate(timestamp, dateOpts);
        }
        else if (typeof timestamp === 'number') {
            this.#date = luxon_1.DateTime.fromMillis(timestamp, dateOpts);
        }
        else {
            this.#date = luxon_1.DateTime.fromISO(timestamp, dateOpts);
            this.#date.isValid || (this.#date = luxon_1.DateTime.fromRFC2822(timestamp, dateOpts));
            this.#date.isValid || (this.#date = luxon_1.DateTime.fromSQL(timestamp, dateOpts));
            this.#date.isValid || (this.#date = luxon_1.DateTime.fromFormat(timestamp, 'EEE, d MMM yyyy HH:mm:ss', dateOpts));
        }
        // Check for valid DateTime and throw an error if not valid.
        if (!this.#date.isValid) {
            throw new Error(`CronDate: unhandled timestamp: ${timestamp}`);
        }
        // Set the timezone if it is provided and different from the current zone.
        if (tz && tz !== this.#date.zoneName) {
            this.#date = this.#date.setZone(tz);
        }
    }
    /**
     * Determines if the given year is a leap year.
     * @param {number} year - The year to check
     * @returns {boolean} - True if the year is a leap year, false otherwise
     * @private
     */
    static #isLeapYear(year) {
        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    }
    /**
     * Returns daylight savings start time.
     * @returns {number | null}
     */
    get dstStart() {
        return this.#dstStart;
    }
    /**
     * Returns the first existing hour after the skipped window, or null.
     * @returns {number | null}
     */
    get dstStartLandingHour() {
        return this.#dstStartLandingHour;
    }
    /**
     * Discards the recorded daylight savings start window. The two halves are
     * only meaningful together, so neither is writable on its own.
     */
    clearDstStart() {
        this.#dstStart = null;
        this.#dstStartLandingHour = null;
    }
    /**
     * Returns daylight savings end time.
     * @returns {number | null}
     */
    get dstEnd() {
        return this.#dstEnd;
    }
    /**
     * Sets daylight savings end time.
     * @param {number | null} value
     */
    set dstEnd(value) {
        this.#dstEnd = value;
    }
    /**
     * Adds one year to the current CronDate.
     */
    addYear() {
        this.#date = this.#date.plus({ years: 1 });
    }
    /**
     * Adds one month to the current CronDate.
     */
    addMonth() {
        this.#date = this.#date.plus({ months: 1 }).startOf('month');
    }
    /**
     * Adds one day to the current CronDate.
     */
    addDay() {
        this.#date = this.#date.plus({ days: 1 }).startOf('day');
    }
    /**
     * Adds one hour to the current CronDate.
     */
    addHour() {
        this.#date = this.#date.plus({ hours: 1 }).startOf('hour');
    }
    /**
     * Adds one minute to the current CronDate.
     */
    addMinute() {
        this.#date = this.#date.plus({ minutes: 1 }).startOf('minute');
    }
    /**
     * Adds one second to the current CronDate.
     */
    addSecond() {
        this.#date = this.#date.plus({ seconds: 1 });
    }
    /**
     * Subtracts one year from the current CronDate.
     */
    subtractYear() {
        this.#date = this.#date.minus({ years: 1 });
    }
    /**
     * Subtracts one month from the current CronDate.
     * If the month is 1, it will subtract one year instead.
     */
    subtractMonth() {
        this.#date = this.#date.minus({ months: 1 }).endOf('month').startOf('second');
    }
    /**
     * Subtracts one day from the current CronDate.
     * If the day is 1, it will subtract one month instead.
     */
    subtractDay() {
        this.#date = this.#date.minus({ days: 1 }).endOf('day').startOf('second');
    }
    /**
     * Subtracts one hour from the current CronDate.
     * If the hour is 0, it will subtract one day instead.
     */
    subtractHour() {
        this.#date = this.#date.minus({ hours: 1 }).endOf('hour').startOf('second');
    }
    /**
     * Subtracts one minute from the current CronDate.
     * If the minute is 0, it will subtract one hour instead.
     */
    subtractMinute() {
        this.#date = this.#date.minus({ minutes: 1 }).endOf('minute').startOf('second');
    }
    /**
     * Subtracts one second from the current CronDate.
     * If the second is 0, it will subtract one minute instead.
     */
    subtractSecond() {
        this.#date = this.#date.minus({ seconds: 1 });
    }
    /**
     * Adds a unit of time to the current CronDate.
     * @param {TimeUnit} unit
     */
    addUnit(unit) {
        switch (unit) {
            case TimeUnit.Year:
                return this.addYear();
            case TimeUnit.Month:
                return this.addMonth();
            case TimeUnit.Day:
                return this.addDay();
            case TimeUnit.Hour:
                return this.addHour();
            case TimeUnit.Minute:
                return this.addMinute();
            case TimeUnit.Second:
                return this.addSecond();
        }
    }
    /**
     * Subtracts a unit of time from the current CronDate.
     * @param {TimeUnit} unit
     */
    subtractUnit(unit) {
        switch (unit) {
            case TimeUnit.Year:
                return this.subtractYear();
            case TimeUnit.Month:
                return this.subtractMonth();
            case TimeUnit.Day:
                return this.subtractDay();
            case TimeUnit.Hour:
                return this.subtractHour();
            case TimeUnit.Minute:
                return this.subtractMinute();
            case TimeUnit.Second:
                return this.subtractSecond();
        }
    }
    /**
     * Handles a math operation.
     * @param {DateMathOp} verb - {'add' | 'subtract'}
     * @param {TimeUnit} unit - {'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'}
     */
    invokeDateOperation(verb, unit) {
        if (verb === DateMathOp.Add) {
            this.addUnit(unit);
            return;
        }
        if (verb === DateMathOp.Subtract) {
            this.subtractUnit(unit);
            return;
        }
        /* istanbul ignore next - this would only happen if an end user call the handleMathOp with an invalid verb */
        throw new Error(`Invalid verb: ${verb}`);
    }
    /**
     * Returns the day.
     * @returns {number}
     */
    getDate() {
        return this.#date.day;
    }
    /**
     * Returns the year.
     * @returns {number}
     */
    getFullYear() {
        return this.#date.year;
    }
    /**
     * Returns the day of the week.
     * @returns {number}
     */
    getDay() {
        const weekday = this.#date.weekday;
        return weekday === 7 ? 0 : weekday;
    }
    /**
     * Returns the month.
     * @returns {number}
     */
    getMonth() {
        return this.#date.month - 1;
    }
    /**
     * Returns the hour.
     * @returns {number}
     */
    getHours() {
        return this.#date.hour;
    }
    /**
     * Returns the minutes.
     * @returns {number}
     */
    getMinutes() {
        return this.#date.minute;
    }
    /**
     * Returns the seconds.
     * @returns {number}
     */
    getSeconds() {
        return this.#date.second;
    }
    /**
     * Returns the milliseconds.
     * @returns {number}
     */
    getMilliseconds() {
        return this.#date.millisecond;
    }
    /**
     * Returns the timezone offset from UTC in minutes (e.g. UTC+2 => 120).
     * Useful for detecting DST transition days.
     *
     * @returns {number} UTC offset in minutes
     */
    getUTCOffset() {
        return this.#date.offset;
    }
    /**
     * Sets the time to the start of the day (00:00:00.000) in the current timezone.
     */
    setStartOfDay() {
        this.#date = this.#date.startOf('day');
    }
    /**
     * Sets the time to the end of the day (23:59:59.999) in the current timezone.
     */
    setEndOfDay() {
        this.#date = this.#date.endOf('day');
    }
    /**
     * Returns the time.
     * @returns {number}
     */
    getTime() {
        return this.#date.valueOf();
    }
    /**
     * Returns the UTC day.
     * @returns {number}
     */
    getUTCDate() {
        return this.#getUTC().day;
    }
    /**
     * Returns the UTC year.
     * @returns {number}
     */
    getUTCFullYear() {
        return this.#getUTC().year;
    }
    /**
     * Returns the UTC day of the week.
     * @returns {number}
     */
    getUTCDay() {
        const weekday = this.#getUTC().weekday;
        return weekday === 7 ? 0 : weekday;
    }
    /**
     * Returns the UTC month.
     * @returns {number}
     */
    getUTCMonth() {
        return this.#getUTC().month - 1;
    }
    /**
     * Returns the UTC hour.
     * @returns {number}
     */
    getUTCHours() {
        return this.#getUTC().hour;
    }
    /**
     * Returns the UTC minutes.
     * @returns {number}
     */
    getUTCMinutes() {
        return this.#getUTC().minute;
    }
    /**
     * Returns the UTC seconds.
     * @returns {number}
     */
    getUTCSeconds() {
        return this.#getUTC().second;
    }
    /**
     * Returns the UTC milliseconds.
     * @returns {string | null}
     */
    toISOString() {
        return this.#date.toUTC().toISO();
    }
    /**
     * Returns the date as a JSON string.
     * @returns {string | null}
     */
    toJSON() {
        return this.#date.toJSON();
    }
    /**
     * Sets the day.
     * @param d
     */
    setDate(d) {
        this.#date = this.#date.set({ day: d });
    }
    /**
     * Sets the year.
     * @param y
     */
    setFullYear(y) {
        this.#date = this.#date.set({ year: y });
    }
    /**
     * Sets the day of the week.
     * @param d
     */
    setDay(d) {
        this.#date = this.#date.set({ weekday: d });
    }
    /**
     * Sets the month.
     * @param m
     */
    setMonth(m) {
        this.#date = this.#date.set({ month: m + 1 });
    }
    /**
     * Sets the hour.
     * @param h
     */
    setHours(h) {
        this.#date = this.#date.set({ hour: h });
    }
    /**
     * Sets the minutes.
     * @param m
     */
    setMinutes(m) {
        this.#date = this.#date.set({ minute: m });
    }
    /**
     * Sets the seconds.
     * @param s
     */
    setSeconds(s) {
        this.#date = this.#date.set({ second: s });
    }
    /**
     * Sets the milliseconds.
     * @param s
     */
    setMilliseconds(s) {
        this.#date = this.#date.set({ millisecond: s });
    }
    /**
     * Returns the date as a string.
     * @returns {string}
     */
    toString() {
        return this.toDate().toString();
    }
    /**
     * Returns the date as a Date object.
     * @returns {Date}
     */
    toDate() {
        return this.#date.toJSDate();
    }
    /**
     * Returns true if the day is the last day of the month.
     * @returns {boolean}
     */
    isLastDayOfMonth() {
        const { day, month } = this.#date;
        // Special handling for February in leap years
        if (month === 2) {
            const isLeap = CronDate.#isLeapYear(this.#date.year);
            return day === exports.DAYS_IN_MONTH[month - 1] - (isLeap ? 0 : 1);
        }
        // For other months, check against the static map
        return day === exports.DAYS_IN_MONTH[month - 1];
    }
    /**
     * Returns true if the day is the last weekday of the month.
     * @returns {boolean}
     */
    isLastWeekdayOfMonth() {
        const { day, month } = this.#date;
        // Get the last day of the current month
        let lastDay;
        if (month === 2) {
            // Special handling for February
            lastDay = exports.DAYS_IN_MONTH[month - 1] - (CronDate.#isLeapYear(this.#date.year) ? 0 : 1);
        }
        else {
            lastDay = exports.DAYS_IN_MONTH[month - 1];
        }
        // Check if the current day is within 7 days of the end of the month
        return day > lastDay - 7;
    }
    /**
     * Primarily for internal use.
     * @param {DateMathOp} op - The operation to perform.
     * @param {TimeUnit} unit - The unit of time to use.
     * @param {number} [hoursLength] - The length of the hours. Required when unit is not month or day.
     */
    applyDateOperation(op, unit, hoursLength) {
        if (unit === TimeUnit.Month || unit === TimeUnit.Day) {
            this.invokeDateOperation(op, unit);
            return;
        }
        const previousHour = this.getHours();
        const previousOffset = this.getUTCOffset();
        this.invokeDateOperation(op, unit);
        const currentHour = this.getHours();
        // Wall-clock hours crossed, modular so a step over midnight measures the
        // same as one within the day.
        const advance = (currentHour - previousHour + 24) % 24;
        // advance >= 2: at least one whole wall-clock hour was skipped, which
        // sub-hour shifts and calendar-day jumps must not qualify as.
        if (op === DateMathOp.Add && this.getUTCOffset() > previousOffset && advance >= 2) {
            if (hoursLength !== 24) {
                // First skipped hour, then the hour landed on. Modulo carries a window
                // that starts at 23:00 over midnight.
                this.#dstStart = (previousHour + 1) % 24;
                this.#dstStartLandingHour = currentHour;
            }
        }
        else if (advance === 0 && this.getMinutes() === 0 && this.getSeconds() === 0) {
            if (hoursLength !== 24) {
                this.dstEnd = currentHour;
            }
        }
    }
    /**
     * Returns the UTC date.
     * @private
     * @returns {DateTime}
     */
    #getUTC() {
        return this.#date.toUTC();
    }
}
exports.CronDate = CronDate;
exports.default = CronDate;
