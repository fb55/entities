/** Number of most-frequent values assigned to 1-char codes. */
const DICT_SIZE = 61;

/**
 * Decode a dictionary-encoded trie string into a Uint16Array.
 *
 * Format: [dict1: D values delta+RLE][dict2: remaining delta+RLE][data]
 *
 * - dict1: D most-frequent values, delta-encoded from 0 → 1-char codes.
 * - dict2: remaining unique values, delta-encoded from 0 → 2-char codes.
 * - data: each trie entry as 1 char (dict1) or 2 chars (dict2).
 * @param input Packed trie string.
 * @param resultLength Expected number of uint16 values in the output.
 * @param headerLength Number of chars occupied by the dict1+dict2 header.
 */
export function decodeTrieDict(
    input: string,
    resultLength: number,
    headerLength: number,
): Uint16Array {
    const base = 91;

    // Build base-91 lookup table inline (91 printable ASCII chars, excluding `"`, `$`, `\`).
    const lookup = new Uint8Array(0x7f);
    for (let codePoint = 0x21, index = 0; codePoint <= 0x7e; codePoint++) {
        if (codePoint !== 0x22 && codePoint !== 0x24 && codePoint !== 0x5c) {
            lookup[codePoint] = index++;
        }
    }

    let pos = 0;

    /*
     * Delta-decode helper: reads `count` values (0 = read until `endPos`).
     *
     * Encoding per delta:
     *   code < 89        → delta = code
     *   code == 89       → RLE: next char = N-2, emit N consecutive +1 values
     *   code == 90       → escape: next chars encode delta-89 (2 or 3 chars)
     */
    function decodeDelta(count: number, endPos: number): number[] {
        const result: number[] = [];
        let previous = 0;
        while (count > 0 ? result.length < count : pos < endPos) {
            const code = lookup[input.charCodeAt(pos)];
            if (code < 89) {
                previous += code;
                pos += 1;
                result.push(previous);
            } else if (code === 89) {
                // RLE: next char encodes count-2, emit count consecutive +1 values
                pos += 1;
                const runLength = lookup[input.charCodeAt(pos)] + 2;
                pos += 1;
                for (let r = 0; r < runLength; r++) {
                    result.push(++previous);
                }
            } else {
                // Escape: next char(s) encode a larger delta
                pos += 1;
                const next = lookup[input.charCodeAt(pos)];
                if (next < 90) {
                    previous +=
                        89 + next * base + lookup[input.charCodeAt(pos + 1)];
                    pos += 2;
                } else {
                    // Double escape
                    pos += 1;
                    previous +=
                        89 +
                        lookup[input.charCodeAt(pos)] * 8281 +
                        lookup[input.charCodeAt(pos + 1)] * base +
                        lookup[input.charCodeAt(pos + 2)];
                    pos += 3;
                }
                result.push(previous);
            }
        }
        return result;
    }

    // Decode dict1: DICT_SIZE values, delta-encoded from 0
    const dict1 = new Uint16Array(decodeDelta(DICT_SIZE, 0));

    // Decode dict2: remaining values until header ends, delta-encoded from 0
    const dict2 = decodeDelta(0, headerLength);

    // Decode data
    const out = new Uint16Array(resultLength);
    let outIndex = 0;
    while (pos < input.length) {
        const code = lookup[input.charCodeAt(pos)];
        if (code < DICT_SIZE) {
            out[outIndex++] = dict1[code];
            pos += 1;
        } else {
            out[outIndex++] =
                dict2[
                    (code - DICT_SIZE) * base +
                        lookup[input.charCodeAt(pos + 1)]
                ];
            pos += 2;
        }
    }

    return out;
}
