"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronField = void 0;
/**
 * Represents a field within a cron expression.
 * This is a base class and should not be instantiated directly.
 * @class CronField
 */
class CronField {
    #hasLastChar = false;
    #hasQuestionMarkChar = false;
    #wildcard = false;
    #values = [];
    options = { rawValue: '' };
    /**
     * Returns the minimum value allowed for this field.
     */
    /* istanbul ignore next */ static get min() {
        /* istanbul ignore next */
        throw new Error('min must be overridden');
    }
    /**
     * Returns the maximum value allowed for this field.
     */
    /* istanbul ignore next */ static get max() {
        /* istanbul ignore next */
        throw new Error('max must be overridden');
    }
    /**
     * Returns the allowed characters for this field.
     */
    /* istanbul ignore next */ static get chars() {
        /* istanbul ignore next - this is overridden */
        return Object.freeze([]);
    }
    /**
     * Returns the regular expression used to validate this field.
     */
    static get validChars() {
        return /^[?,*\dH/-]+$|^.*H\(\d+-\d+\)\/\d+.*$|^.*H\(\d+-\d+\).*$|^.*H\/\d+.*$/;
    }
    /**
     * Returns the constraints for this field.
     */
    static get constraints() {
        return { min: this.min, max: this.max, chars: this.chars, validChars: this.validChars };
    }
    /**
     * CronField constructor. Initializes the field with the provided values.
     * @param {number[] | string[]} values - Values for this field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     * @throws {TypeError} if the constructor is called directly
     * @throws {Error} if validation fails
     */
    constructor(values, options = { rawValue: '' }) {
        if (!Array.isArray(values)) {
            throw new Error(`${this.constructor.name} Validation error, values is not an array`);
        }
        if (!(values.length > 0)) {
            throw new Error(`${this.constructor.name} Validation error, values contains no values`);
        }
        /* istanbul ignore next */
        this.options = {
            ...options,
            rawValue: options.rawValue ?? '',
        };
        this.#values = [...values].sort(CronField.sorter);
        this.#wildcard = this.options.wildcard !== undefined ? this.options.wildcard : this.#isWildcardValue();
        this.#hasLastChar = this.options.rawValue.includes('L') || values.includes('L');
        this.#hasQuestionMarkChar = this.options.rawValue.includes('?') || values.includes('?');
    }
    /**
     * Returns the minimum value allowed for this field.
     * @returns {number}
     */
    get min() {
        // return the static value from the child class
        return this.constructor.min;
    }
    /**
     * Returns the maximum value allowed for this field.
     * @returns {number}
     */
    get max() {
        // return the static value from the child class
        return this.constructor.max;
    }
    /**
     * Returns an array of allowed special characters for this field.
     * @returns {string[]}
     */
    get chars() {
        // return the frozen static value from the child class
        return this.constructor.chars;
    }
    /**
     * Indicates whether this field has a "last" character.
     * @returns {boolean}
     */
    get hasLastChar() {
        return this.#hasLastChar;
    }
    /**
     * Indicates whether this field has a "question mark" character.
     * @returns {boolean}
     */
    get hasQuestionMarkChar() {
        return this.#hasQuestionMarkChar;
    }
    /**
     * Indicates whether this field is a wildcard.
     * @returns {boolean}
     */
    get isWildcard() {
        return this.#wildcard;
    }
    /**
     * Returns an array of allowed values for this field.
     * @returns {CronFieldType}
     */
    get values() {
        return this.#values;
    }
    /**
     * Helper function to sort values in ascending order.
     * @param {number | string} a - First value to compare
     * @param {number | string} b - Second value to compare
     * @returns {number} - A negative, zero, or positive value, depending on the sort order
     */
    static sorter(a, b) {
        const aIsNumber = typeof a === 'number';
        const bIsNumber = typeof b === 'number';
        if (aIsNumber && bIsNumber)
            return a - b;
        if (!aIsNumber && !bIsNumber)
            return a.localeCompare(b);
        return aIsNumber ? /* istanbul ignore next - A will always be a number until L-2 is supported */ -1 : 1;
    }
    /**
     * Find the next (or previous when `reverse` is true) numeric value in a sorted list.
     * Returns null if there's no value strictly after/before the current one.
     *
     * @param values - Sorted numeric values
     * @param currentValue - Current value to compare against
     * @param reverse - When true, search in reverse for previous smaller value
     */
    static findNearestValueInList(values, currentValue, reverse) {
        if (reverse) {
            for (let i = values.length - 1; i >= 0; i--) {
                if (values[i] < currentValue)
                    return values[i];
            }
            return null;
        }
        for (let i = 0; i < values.length; i++) {
            if (values[i] > currentValue)
                return values[i];
        }
        return null;
    }
    /**
     * Instance helper that operates on this field's numeric `values`.
     *
     * @param currentValue - Current value to compare against
     * @param reverse - When true, search in reverse for previous smaller value
     */
    findNearestValue(currentValue, reverse) {
        return this.constructor.findNearestValueInList(this.values, currentValue, reverse);
    }
    /**
     * Serializes the field to an object.
     * @returns {SerializedCronField}
     */
    serialize() {
        return {
            wildcard: this.#wildcard,
            values: this.#values,
        };
    }
    /**
     * Validates the field values against the allowed range and special characters.
     * @throws {Error} if validation fails
     */
    validate() {
        let badValue;
        const charsString = this.chars.length > 0 ? ` or chars ${this.chars.join('')}` : '';
        const charTest = (value) => (char) => new RegExp(`^\\d{0,2}${char}$`).test(value);
        const rangeTest = (value) => {
            badValue = value;
            return typeof value === 'number' ? value >= this.min && value <= this.max : this.chars.some(charTest(value));
        };
        const isValidRange = this.#values.every(rangeTest);
        if (!isValidRange) {
            throw new Error(`${this.constructor.name} Validation error, got value ${badValue} expected range ${this.min}-${this.max}${charsString}`);
        }
        // check for duplicate value in this.#values array
        const duplicate = this.#values.find((value, index) => this.#values.indexOf(value) !== index);
        if (duplicate) {
            throw new Error(`${this.constructor.name} Validation error, duplicate values found: ${duplicate}`);
        }
    }
    /**
     * Determines if the field is a wildcard based on the values.
     * When options.rawValue is not empty, it checks if the raw value is a wildcard, otherwise it checks if all values in the range are included.
     * @returns {boolean}
     */
    #isWildcardValue() {
        if (this.options.rawValue.length > 0) {
            return ['*', '?'].includes(this.options.rawValue);
        }
        return Array.from({ length: this.max - this.min + 1 }, (_, i) => i + this.min).every((value) => this.#values.includes(value));
    }
}
exports.CronField = CronField;
