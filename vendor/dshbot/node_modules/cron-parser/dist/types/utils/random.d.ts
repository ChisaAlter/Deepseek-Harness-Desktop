/**
 * A type representing a Pseudorandom Number Generator, similar to Math.random()
 */
export type PRNG = () => number;
/**
 * Generates a PRNG using a given seed. When not provided, the seed is randomly generated
 * @param {string} str A string to derive the seed from
 * @returns {PRNG} A random number generator correctly seeded
 */
export declare function seededRandom(str?: string): PRNG;
