"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronFileParser = void 0;
const CronExpressionParser_1 = require("./CronExpressionParser");
/**
 * Parser for crontab files that handles both synchronous and asynchronous operations.
 */
class CronFileParser {
    /**
     * Parse a crontab file asynchronously
     * @param filePath Path to crontab file
     * @returns Promise resolving to parse results
     * @throws If file cannot be read
     */
    static async parseFile(filePath) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readFile } = require('fs/promises');
        const data = await readFile(filePath, 'utf8');
        return CronFileParser.#parseContent(data);
    }
    /**
     * Parse a crontab file synchronously
     * @param filePath Path to crontab file
     * @returns Parse results
     * @throws If file cannot be read
     */
    static parseFileSync(filePath) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readFileSync } = require('fs');
        const data = readFileSync(filePath, 'utf8');
        return CronFileParser.#parseContent(data);
    }
    /**
     * Internal method to parse crontab file content
     * @private
     */
    static #parseContent(data) {
        const blocks = data.split('\n');
        const result = {
            variables: {},
            expressions: [],
            errors: {},
        };
        for (const block of blocks) {
            const entry = block.trim();
            if (entry.length === 0 || entry.startsWith('#')) {
                continue;
            }
            const variableMatch = entry.match(/^(.*)=(.*)$/);
            if (variableMatch) {
                const [, key, value] = variableMatch;
                result.variables[key] = value.replace(/["']/g, ''); // Remove quotes
                continue;
            }
            try {
                const parsedEntry = CronFileParser.#parseEntry(entry);
                result.expressions.push(parsedEntry.interval);
            }
            catch (err) {
                result.errors[entry] = err;
            }
        }
        return result;
    }
    /**
     * Parse a single crontab entry
     * @private
     */
    static #parseEntry(entry) {
        const atoms = entry.split(' ');
        return {
            interval: CronExpressionParser_1.CronExpressionParser.parse(atoms.slice(0, 5).join(' ')),
            command: atoms.slice(5, atoms.length),
        };
    }
}
exports.CronFileParser = CronFileParser;
