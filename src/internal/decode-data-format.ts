/**
 * Constants and helpers shared between the decode-data generator
 * (`scripts/write-decode-map.ts`) and the runtime (`src/decode.ts`).
 *
 * The format and the algorithms — front-coded names, exact 32-bit keys in a
 * two-choice cuckoo table, the length-probe front end, and the measured
 * engineering notes — are documented with references in
 * `scripts/README.md`.
 */

/** Bias added to every meta char so none needs escaping in JS source. */
export const META_BIAS = 0x23;
/** Bias for header and choice-bit chars. */
export const HEADER_BIAS = 0x30;
/** Number of header chars: n (2), suffixes length (2), bucket count (2). */
export const HEADER_LENGTH = 6;
/** Choice bits packed per char. */
export const CHOICE_BITS_PER_CHAR = 6;

/** Multiplier deriving the first candidate bucket from a key. */
export const BUCKET_HASH_1 = 0x9e_37_79_b1;
/** Multiplier deriving the second candidate bucket from a key. */
export const BUCKET_HASH_2 = 0x85_eb_ca_6b;

/** Size of the (c0,c1) class table (10-bit index). */
export const PAIR_TABLE_SIZE = 1024;

/**
 * Map an alphanumeric char code to 6 bits (1..62); 0 = not alphanumeric.
 * Used for the key's last-character field.
 */
export const CHAR_REMAP: Uint8Array = ((): Uint8Array => {
    const remap = new Uint8Array(128);
    for (let code = 0x30; code <= 0x39; code++) remap[code] = code - 0x2f;
    for (let code = 0x41; code <= 0x5a; code++) remap[code] = code - 0x36;
    for (let code = 0x61; code <= 0x7a; code++) remap[code] = code - 0x3c;
    return remap;
})();

/**
 * The exact 32-bit key for a name occurring at `nameStart` with `length`
 * chars. Covers the first two and last two characters plus the length;
 * middle characters are verified separately against the names blob.
 *
 * The hot decoder inlines this computation; tests assert both stay in sync
 * by looking every entity up through the public API.
 * @param text Text containing the name.
 * @param nameStart Index of the name's first character.
 * @param length Length of the name.
 */
export function exactKey(
    text: string,
    nameStart: number,
    length: number,
): number {
    return (
        (text.charCodeAt(nameStart) << 25) |
        (text.charCodeAt(nameStart + 1) << 18) |
        (text.charCodeAt(nameStart + length - 2) << 11) |
        (CHAR_REMAP[text.charCodeAt(nameStart + length - 1)] << 5) |
        length
    );
}

/**
 * The 10-bit (c0,c1) class index used by the probe front end. The function
 * was chosen by exhaustive search over load-free mixers for minimal
 * candidate-set collisions on the real entity set.
 * @param c0 First char code of the candidate name.
 * @param c1 Second char code.
 */
export function pairIndex(c0: number, c1: number): number {
    return (((c0 * 3) << 3) ^ c1) & (PAIR_TABLE_SIZE - 1);
}

/**
 * First candidate bucket for a key in a table of `buckets` buckets.
 * @param key Exact key.
 * @param buckets Bucket count.
 */
export function bucketOne(key: number, buckets: number): number {
    return ((Math.imul(key, BUCKET_HASH_1) >>> 16) * buckets) >>> 16;
}

/**
 * Second candidate bucket for a key.
 * @param key Exact key.
 * @param buckets Bucket count.
 */
export function bucketTwo(key: number, buckets: number): number {
    return ((Math.imul(key, BUCKET_HASH_2) >>> 16) * buckets) >>> 16;
}
