import { CronExpression } from './CronExpression';
export type CronFileParserResult = {
    variables: {
        [key: string]: string;
    };
    expressions: CronExpression[];
    errors: {
        [key: string]: unknown;
    };
};
/**
 * Parser for crontab files that handles both synchronous and asynchronous operations.
 */
export declare class CronFileParser {
    #private;
    /**
     * Parse a crontab file asynchronously
     * @param filePath Path to crontab file
     * @returns Promise resolving to parse results
     * @throws If file cannot be read
     */
    static parseFile(filePath: string): Promise<CronFileParserResult>;
    /**
     * Parse a crontab file synchronously
     * @param filePath Path to crontab file
     * @returns Parse results
     * @throws If file cannot be read
     */
    static parseFileSync(filePath: string): CronFileParserResult;
}
