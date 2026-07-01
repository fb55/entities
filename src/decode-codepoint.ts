// Adapted from https://github.com/mathiasbynens/he/blob/36afe179392226cf1b6ccdb16ebbb7a5a844d93a/src/he.js#L106-L134

/**
 * C1 Unicode control character reference replacements (code points 128–159).
 * Index i gives the replacement for code point 128+i; 0 means "no replacement".
 */
const c1: number[] = [
    8364, 0, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 0,
    381, 0, 0, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250,
    339, 0, 382, 376,
];

/**
 * Replace the given code point with a replacement character if it is a
 * surrogate or is outside the valid range. Otherwise return the code
 * point unchanged.
 * @param codePoint Unicode code point to convert.
 */
export function replaceCodePoint(codePoint: number): number {
    if (
        codePoint === 0 ||
        (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff) ||
        codePoint > 0x10_ff_ff
    ) {
        return 0xff_fd;
    }

    if (codePoint >= 128 && codePoint <= 159) {
        return c1[codePoint - 128] || codePoint;
    }

    return codePoint;
}

/**
 * Convert the code point of a decoded numeric entity to a string, replacing
 * invalid values.
 *
 * Fast path for plain BMP code points: [1..0x7F] and [0xA0..0xD7FF] pass
 * `replaceCodePoint` unchanged (no NUL, C1 remap, surrogate, or out-of-range
 * handling) and fit a single charCode. 0xd760 = 0xD800 (the first surrogate)
 * - 0xA0.
 * @param codePoint Unicode code point to convert.
 */
export function codePointToString(codePoint: number): string {
    return (codePoint - 1) >>> 0 < 0x7f || (codePoint - 0xa0) >>> 0 < 0xd7_60
        ? String.fromCharCode(codePoint)
        : String.fromCodePoint(replaceCodePoint(codePoint));
}
