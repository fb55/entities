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

/**
 * Decode data for the HTML entity set, built from the serialized form at
 * module init. The format and the algorithms operating on it are documented
 * in `scripts/README.md`. XML's five entities are matched directly and
 * ship no data.
 */
export interface DecodeData {
    /** Exact 32-bit keys; two-slot buckets, slot index = 2*bucket (+1). */
    keys: Int32Array;
    /** Bucket count for the cuckoo table. */
    buckets: number;
    /**
     * Per-slot middle offset: a character offset in `middles` for names up to
     * 16 characters, or a word offset in `longMiddles` for longer names.
     */
    slotMidOff: Uint16Array;
    /**
     * Per-slot value location in `values`, packed as `(offset << 2) | (len -
     * 1)`. Replaces a per-slot `string[]`: half the footprint and no
     * per-value heap objects, for a slightly costlier emit (see
     * `emitHtmlValue`).
     */
    slotValue: Uint16Array;
    /** Concatenated replacement values; indexed via `slotValue`. */
    values: string;
    /** Per-slot legacy (semicolon-optional) flag, one bit per slot. */
    legacyBits: Uint8Array;
    /**
     * Per (c0,c1) class: candidate name lengths. Bits 0-14 = exact lengths
     * 2..16, bit 15 = lengths above 16 exist, bits 16-20 = legacy lengths.
     */
    lengthBits: Uint32Array;
    /** Deduplicated middle characters for names up to 16 characters long. */
    middles: string;
    /** Long-name middles, word-aligned and packed four ASCII characters per word. */
    longMiddles: Uint32Array;
}

/**
 * Build the lookup structures from a serialized dataset.
 * @param packed Serialized decode data, see `decode-data-format.ts`.
 */
export function initDecodeData(packed: readonly [string, string]): DecodeData {
    const [data, values] = packed;
    const nameCount =
        ((data.charCodeAt(0) - HEADER_BIAS) << 6) |
        (data.charCodeAt(1) - HEADER_BIAS);
    const suffixesLength =
        ((data.charCodeAt(2) - HEADER_BIAS) << 6) |
        (data.charCodeAt(3) - HEADER_BIAS);
    const buckets =
        ((data.charCodeAt(4) - HEADER_BIAS) << 6) |
        (data.charCodeAt(5) - HEADER_BIAS);
    const metaStart = HEADER_LENGTH + suffixesLength;
    const choicesStart = metaStart + 2 * nameCount;

    const slotCount = 2 * buckets;
    const keys = new Int32Array(slotCount);
    const slotMidOff = new Uint16Array(slotCount);
    const slotValue = new Uint16Array(slotCount);
    const legacyBits = new Uint8Array((slotCount + 7) >> 3);
    const lengthBits = new Uint32Array(PAIR_TABLE_SIZE);
    const middleOffsets = new Map<string, number>();
    let middles = "";
    const longMiddles: number[] = [];
    let name = "";
    let suffixOffset = HEADER_LENGTH;
    let valueOffset = 0;

    for (let index = 0; index < nameCount; index++) {
        const meta0 = data.charCodeAt(metaStart + 2 * index) - META_BIAS;
        const meta1 = data.charCodeAt(metaStart + 2 * index + 1) - META_BIAS;
        const prefixLength = meta0 & 31;
        const length = prefixLength + (meta1 & 31);
        const valueLength = (meta1 >> 5) + 1;
        name =
            name.slice(0, prefixLength) +
            data.slice(suffixOffset, suffixOffset + length - prefixLength);
        suffixOffset += length - prefixLength;

        const key = exactKey(name, 0, length);
        const choice =
            (data.charCodeAt(
                choicesStart + Math.floor(index / CHOICE_BITS_PER_CHAR),
            ) -
                HEADER_BIAS) &
            (1 << (index % CHOICE_BITS_PER_CHAR));
        let slot = 2 * (choice === 0 ? bucketOne : bucketTwo)(key, buckets);
        if (keys[slot] !== 0) slot += 1;
        keys[slot] = key;

        if (length > 4) {
            const middle = name.slice(2, length - 2);
            const existing = middleOffsets.get(middle);
            if (existing === undefined) {
                if (length > 16) {
                    middleOffsets.set(middle, longMiddles.length);
                    slotMidOff[slot] = longMiddles.length;
                    for (
                        let middleIndex = 0;
                        middleIndex < middle.length;
                        middleIndex += 4
                    ) {
                        longMiddles.push(
                            middle.charCodeAt(middleIndex) |
                                (middle.charCodeAt(middleIndex + 1) << 8) |
                                (middle.charCodeAt(middleIndex + 2) << 16) |
                                (middle.charCodeAt(middleIndex + 3) << 24),
                        );
                    }
                } else {
                    middleOffsets.set(middle, middles.length);
                    slotMidOff[slot] = middles.length;
                    middles += middle;
                }
            } else {
                slotMidOff[slot] = existing;
            }
        }

        const pair = pairIndex(name.charCodeAt(0), name.charCodeAt(1));
        lengthBits[pair] |= length <= 16 ? 1 << (length - 2) : 0x80_00;
        if ((meta0 & 0x20) !== 0) {
            legacyBits[slot >> 3] |= 1 << (slot & 7);
            lengthBits[pair] |= 1 << (length - 2 + 16);
        }

        /*
         * (offset << 2) | (len - 1): the field fits len 1..4, though the
         * generator caps values at 2 units (the streaming emit limit);
         * offset stays within the 14 remaining Uint16 bits (asserted at
         * generation time).
         */
        slotValue[slot] = (valueOffset << 2) | (valueLength - 1);
        valueOffset += valueLength;
    }

    return {
        keys,
        buckets,
        slotMidOff,
        slotValue,
        values,
        legacyBits,
        lengthBits,
        middles,
        longMiddles: new Uint32Array(longMiddles),
    };
}
