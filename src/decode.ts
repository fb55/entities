import { replaceCodePoint } from "./decode-codepoint.js";
import { htmlDecodeData } from "./generated/decode-data-html.js";
import {
    BUCKET_HASH_1,
    BUCKET_HASH_2,
    CHAR_REMAP,
    CHOICE_BITS_PER_CHAR,
    HEADER_BIAS,
    HEADER_LENGTH,
    META_BIAS,
    PAIR_TABLE_SIZE,
    pairIndex,
} from "./internal/decode-data-format.js";

const enum CharCodes {
    AMP = 38, // "&"
    NUM = 35, // "#"
    SEMI = 59, // ";"
    EQUALS = 61, // "="
    ZERO = 48, // "0"
    NINE = 57, // "9"
    LOWER_A = 97, // "a"
    LOWER_F = 102, // "f"
    LOWER_G = 103, // "g"
    LOWER_L = 108, // "l"
    LOWER_Q = 113, // "q"
    LOWER_X = 120, // "x"
    UPPER_A = 65, // "A"
    UPPER_F = 70, // "F"
}

/** Bit that needs to be set to convert an upper case ASCII character to lower case */
const TO_LOWER_BIT = 0b10_0000;

/**
 * Unsigned subtraction trick: (code - lo) >>> 0 wraps negatives to large
 * values, so a single `<=` covers the entire [lo..hi] range check.
 * @param code Code point to check.
 */
function isNumber(code: number): boolean {
    return (code - CharCodes.ZERO) >>> 0 <= 9;
}

function isHexadecimalCharacter(code: number): boolean {
    return ((code | TO_LOWER_BIT) - CharCodes.LOWER_A) >>> 0 <= 5; // F - a
}

function isAlphaNumeric(code: number): boolean {
    return (
        isNumber(code) ||
        ((code | TO_LOWER_BIT) - CharCodes.LOWER_A) >>> 0 <= 25 // Z - a
    );
}

/**
 * Checks if the given character is a valid end character for an entity in an attribute.
 *
 * Attribute values that aren't terminated properly aren't parsed, and shouldn't lead to a parser error.
 * See the example in https://html.spec.whatwg.org/multipage/parsing.html#named-character-reference-state
 * @param code Code point to check.
 */
function isEntityInAttributeInvalidEnd(code: number): boolean {
    return code === CharCodes.EQUALS || isAlphaNumeric(code);
}

/**
 * Decoding mode for named entities.
 */
export enum DecodingMode {
    /** Entities in text nodes that can end with any character. */
    Legacy = 0,
    /** Only allow entities terminated with a semicolon. */
    Strict = 1,
    /** Entities in attributes have limitations on ending characters. */
    Attribute = 2,
}

/**
 * Decode data for the HTML entity set, built from the serialized form at
 * module init. The format and the algorithms operating on it are documented
 * in `src/internal/decode-data-format.ts`. XML's five entities are matched
 * directly (`matchXmlEntity`) and ship no data.
 */
interface DecodeData {
    /** Exact 32-bit keys; two-slot buckets, slot index = 2*bucket (+1). */
    keys: Int32Array;
    /** Bucket count for the cuckoo table. */
    buckets: number;
    /** Per-slot offset of the name's middle chars in `middles`. */
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
    /** Deduplicated middle characters (name positions 2..length-3). */
    middles: string;
}

/**
 * Build the lookup structures from a serialized dataset.
 * @param packed Serialized decode data, see `decode-data-format.ts`.
 */
function buildDecodeData(packed: readonly [string, string]): DecodeData {
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

        /*
         * The key computation must match `findSlotHtml`; the exhaustive
         * lookup test in decode.spec.ts pins the two together.
         */
        // Bitwise OR keeps every step in int32; no further coercion needed.
        const key =
            (name.charCodeAt(0) << 25) |
            (name.charCodeAt(1) << 18) |
            (name.charCodeAt(length - 2) << 11) |
            (CHAR_REMAP[name.charCodeAt(length - 1)] << 5) |
            length;
        const choice =
            (data.charCodeAt(
                choicesStart + Math.floor(index / CHOICE_BITS_PER_CHAR),
            ) -
                HEADER_BIAS) &
            (1 << (index % CHOICE_BITS_PER_CHAR));
        const hash = choice === 0 ? BUCKET_HASH_1 : BUCKET_HASH_2;
        let slot = 2 * (((Math.imul(key, hash) >>> 16) * buckets) >>> 16);
        if (keys[slot] !== 0) slot += 1;
        keys[slot] = key;

        if (length > 4) {
            const middle = name.slice(2, length - 2);
            const existing = middleOffsets.get(middle);
            if (existing === undefined) {
                middleOffsets.set(middle, middles.length);
                slotMidOff[slot] = middles.length;
                middles += middle;
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
         * (offset << 2) | (len - 1): len is 1..4, offset stays within the
         * 14 remaining Uint16 bits (the values blob is well under 16K chars).
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
    };
}

/** Decode data for HTML entities. */
const htmlDecode: DecodeData = /* #__PURE__ */ buildDecodeData(htmlDecodeData);

/*
 * Every decoder below is specialized over these module-level constants. V8
 * compiles direct references to them roughly 20% faster than property loads
 * off a shared object.
 */
const htmlKeys = /* #__PURE__ */ ((): Int32Array => htmlDecode.keys)();
const htmlBuckets = /* #__PURE__ */ ((): number => htmlDecode.buckets)();
const htmlSlotMidOff = /* #__PURE__ */ ((): Uint16Array =>
    htmlDecode.slotMidOff)();
const htmlLengthBits = /* #__PURE__ */ ((): Uint32Array =>
    htmlDecode.lengthBits)();
const htmlMiddles = /* #__PURE__ */ ((): string => htmlDecode.middles)();
const htmlLegacyBits = /* #__PURE__ */ ((): Uint8Array =>
    htmlDecode.legacyBits)();
/** Hoisted for the specialized HTML cores; see `emitHtmlValue`. */
const htmlSlotValue = /* #__PURE__ */ ((): Uint16Array =>
    htmlDecode.slotValue)();
const htmlValues = /* #__PURE__ */ ((): string => htmlDecode.values)();

/**
 * The replacement string for a packed `slotValue` entry. The 1-char case
 * (the vast majority) avoids `slice`'s substring allocation.
 * @param packed `(offset << 2) | (length - 1)` from `htmlSlotValue`.
 */
function emitHtmlValue(packed: number): string {
    const off = packed >> 2;
    return (packed & 3) === 0
        ? String.fromCharCode(htmlValues.charCodeAt(off))
        : htmlValues.slice(off, off + (packed & 3) + 1);
}

/**
 * Find the slot matching `text[start..start+length)`, or -1. A match proves
 * every character of the span (exact key + middle comparison).
 * @param text Input text.
 * @param start Start of the span in `text`.
 * @param length Length of the span.
 */
function findSlotHtml(text: string, start: number, length: number): number {
    const c0 = text.charCodeAt(start);
    const c1 = text.charCodeAt(start + 1);
    const c2 = text.charCodeAt(start + length - 2);
    const c3 = text.charCodeAt(start + length - 1);
    /*
     * Probed spans aren't pre-filtered to alphanumerics; characters >= 0x80
     * would alias mod 128 inside the packed 7-bit fields, so reject them
     * before they can forge a key.
     */
    if ((c0 | c1 | c2 | c3) > 127) return -1;
    const key =
        (c0 << 25) | (c1 << 18) | (c2 << 11) | (CHAR_REMAP[c3] << 5) | length;
    let slot =
        2 * (((Math.imul(key, BUCKET_HASH_1) >>> 16) * htmlBuckets) >>> 16);
    for (let attempt = 0; ; attempt++) {
        if (
            htmlKeys[slot] === key &&
            isMidMatchHtml(slot, text, start, length)
        ) {
            return slot;
        }
        if (
            htmlKeys[slot + 1] === key &&
            isMidMatchHtml(slot + 1, text, start, length)
        ) {
            return slot + 1;
        }
        if (attempt === 1) return -1;
        slot =
            2 * (((Math.imul(key, BUCKET_HASH_2) >>> 16) * htmlBuckets) >>> 16);
    }
}

/**
 * Compare the middle characters (positions 2..length-3) of the candidate at
 * `slot` against the input. The key already proves the outer characters and
 * the length.
 * @param slot Slot of the candidate.
 * @param text Input text.
 * @param start Start of the span in `text`.
 * @param length Length of the span.
 */
function isMidMatchHtml(
    slot: number,
    text: string,
    start: number,
    length: number,
): boolean {
    if (length <= 4) return true;
    let middleIndex = htmlSlotMidOff[slot];
    let textIndex = start + 2;
    const end = start + length - 2;
    while (
        textIndex < end &&
        htmlMiddles.charCodeAt(middleIndex) === text.charCodeAt(textIndex)
    ) {
        textIndex++;
        middleIndex++;
    }
    return textIndex === end;
}

/**
 * `parseNumericEntity` packs its two results into one integer:
 * `(consumed << CONSUMED_SHIFT) | codePoint`. The code point occupies the low
 * 21 bits (max 0x110000, clamped before packing); `consumed` takes the upper
 * 11 bits and is read back with `>>> CONSUMED_SHIFT`, so the sign bit set by a
 * large `consumed` is harmless. A zero return means "no numeric entity".
 */
const enum NumericPacking {
    CONSUMED_SHIFT = 21,
    CODE_POINT_MASK = 0x1f_ff_ff,
}

/**
 * Parse a numeric entity starting right after the `#`. In legacy mode the
 * terminating semicolon is optional. Returns the number of characters
 * consumed (counting the `&` and `#`) packed with the code point (see
 * `NumericPacking`), or 0 if there is no valid numeric entity at this
 * position.
 * @param input Input string.
 * @param offset Index right after the `#`.
 * @param isStrict Whether a terminating semicolon is required.
 */
function parseNumericEntity(
    input: string,
    offset: number,
    isStrict: boolean,
): number {
    const inputLength = input.length;
    let index = offset;
    let codePoint = 0;
    let digitsStart: number;

    if ((input.charCodeAt(index) | TO_LOWER_BIT) === CharCodes.LOWER_X) {
        // Hexadecimal entity.
        index += 1;
        digitsStart = index;
        while (index < inputLength) {
            const char = input.charCodeAt(index);
            if (isNumber(char)) {
                codePoint = codePoint * 16 + (char - CharCodes.ZERO);
            } else if (isHexadecimalCharacter(char)) {
                codePoint =
                    codePoint * 16 +
                    ((char | TO_LOWER_BIT) - CharCodes.LOWER_A + 10);
            } else {
                break;
            }
            index += 1;
        }
    } else {
        digitsStart = index;
        while (index < inputLength) {
            const char = input.charCodeAt(index);
            if (!isNumber(char)) break;
            codePoint = codePoint * 10 + (char - CharCodes.ZERO);
            index += 1;
        }
    }
    if (index === digitsStart) return 0;

    // Clamp once after the loop instead of per digit.
    if (codePoint > 0x10_ff_ff) codePoint = 0x11_00_00;

    let consumed = index - offset + 2; // Includes "#" and the "&" position.
    if (index < inputLength && input.charCodeAt(index) === CharCodes.SEMI) {
        consumed += 1;
    } else if (isStrict) {
        return 0;
    }

    return (consumed << NumericPacking.CONSUMED_SHIFT) | codePoint;
}

/**
 * The decoded string for a numeric entity's code point, applying the
 * windows-1252 replacement map and validity rules.
 * @param codePoint Parsed code point (possibly clamped to 0x110000).
 */
function numericValue(codePoint: number): string {
    // Common case: a BMP code point that needs no replacement.
    if ((codePoint - 1) >>> 0 < 0x7f || (codePoint - 0xa0) >>> 0 < 0xd7_60) {
        return String.fromCharCode(codePoint);
    }
    return String.fromCodePoint(replaceCodePoint(codePoint));
}

/**
 * Find the longest legacy (semicolon-less) match for the name starting at
 * `start`, using the per-class legacy length bits. Returns
 * `slot << 3 | matchLength`, or -1 if there is no match. Only called after
 * the exact probes failed (the miss path).
 * @param input Input text.
 * @param start Start of the name.
 * @param maxLength Number of available run characters.
 */
function findLegacySlot(
    input: string,
    start: number,
    maxLength: number,
): number {
    let legacy =
        (htmlLengthBits[
            pairIndex(input.charCodeAt(start), input.charCodeAt(start + 1))
        ] >>>
            16) &
        31;
    while (legacy !== 0) {
        // Longest first: the spec matches references greedily.
        const top = 31 - Math.clz32(legacy);
        legacy ^= 1 << top;
        if (top + 2 > maxLength) continue;
        const slot = findSlotHtml(input, start, top + 2);
        if (
            slot >= 0 &&
            (htmlLegacyBits[slot >> 3] & (1 << (slot & 7))) !== 0
        ) {
            return (slot << 3) | (top + 2);
        }
    }
    return -1;
}

/**
 * Match one of XML's five predefined entities (name plus the terminating
 * semicolon) at `start`. Returns `(consumedLength << 7) | codePoint` where
 * `consumedLength` counts the name and the semicolon, or -1 if nothing
 * matches. All five patterns are decided within five characters of `start`,
 * so the entity set ships no decode data.
 * @param input Input text.
 * @param start Index of the name's first character (right after the `&`).
 */
function matchXmlEntity(input: string, start: number): number {
    switch (input.charCodeAt(start)) {
        case CharCodes.LOWER_L: {
            return input.startsWith("t;", start + 1) ? (3 << 7) | 0x3c : -1;
        }
        case CharCodes.LOWER_G: {
            return input.startsWith("t;", start + 1) ? (3 << 7) | 0x3e : -1;
        }
        case CharCodes.LOWER_A: {
            if (input.startsWith("mp;", start + 1)) return (4 << 7) | 0x26;
            return input.startsWith("pos;", start + 1) ? (5 << 7) | 0x27 : -1;
        }
        case CharCodes.LOWER_Q: {
            return input.startsWith("uot;", start + 1) ? (5 << 7) | 0x22 : -1;
        }
        default: {
            return -1;
        }
    }
}

/**
 * The code point for one of XML's five predefined entity names (without the
 * semicolon), or -1. Used by the streaming decoder, where the name may have
 * been buffered across chunk boundaries.
 * @param name Candidate entity name.
 */
function xmlCodePoint(name: string): number {
    switch (name) {
        case "amp": {
            return 0x26;
        }
        case "apos": {
            return 0x27;
        }
        case "gt": {
            return 0x3e;
        }
        case "lt": {
            return 0x3c;
        }
        case "quot": {
            return 0x22;
        }
        default: {
            return -1;
        }
    }
}

/**
 * The next `&` to resume from after emitting a replacement, given the index
 * just past it. A leaf the decoders call after every emit: the common
 * adjacent-entity case (`&amp;&lt;`) skips the `indexOf` C++ call.
 * @param input Input text.
 * @param last Index just past the entity that was emitted.
 */
function nextOffset(input: string, last: number): number {
    return input.charCodeAt(last) === CharCodes.AMP
        ? last
        : input.indexOf("&", last);
}

/**
 * Synchronous XML decoder. Strict semantics throughout: every entity
 * requires its terminator.
 * @param input String to decode.
 */
function decodeXmlText(input: string): string {
    let offset = input.indexOf("&");
    if (offset < 0) return input;

    let result = "";
    let last = 0;

    do {
        const start = offset + 1;
        const c0 = input.charCodeAt(start);

        if (c0 === CharCodes.AMP) {
            offset = start;
            continue;
        }

        if (c0 === CharCodes.NUM) {
            const packed = parseNumericEntity(input, start + 1, true);
            const consumed = packed >>> NumericPacking.CONSUMED_SHIFT;
            if (consumed === 0) {
                offset = input.indexOf("&", start);
            } else {
                if (last !== offset) {
                    result += input.slice(last, offset);
                }
                result += numericValue(packed & NumericPacking.CODE_POINT_MASK);
                last = offset + consumed;
                offset = nextOffset(input, last);
            }
            continue;
        }

        const packed = matchXmlEntity(input, start);
        if (packed >= 0) {
            if (last !== offset) {
                result += input.slice(last, offset);
            }
            result += String.fromCharCode(packed & 127);
            last = start + (packed >> 7);
            offset = nextOffset(input, last);
            continue;
        }

        offset = input.indexOf("&", start + 1);
    } while (offset >= 0);

    return result + input.slice(last);
}

/**
 * Synchronous HTML decoder, shared by all three decoding modes.
 * @param input String to decode.
 * @param mode Decoding mode for named entities.
 */
function decodeHtmlText(input: string, mode: DecodingMode): string {
    const isLegacyAllowed = mode !== DecodingMode.Strict;
    const isStrictNumbers = mode === DecodingMode.Strict;
    let offset = input.indexOf("&");
    if (offset < 0) return input;

    const inputLength = input.length;
    let result = "";
    let last = 0;

    do {
        const start = offset + 1;
        const c0 = input.charCodeAt(start);

        if (c0 === CharCodes.AMP) {
            // Adjacent "&&": re-enter directly, skipping indexOf.
            offset = start;
            continue;
        }

        if (c0 === CharCodes.NUM) {
            const packed = parseNumericEntity(
                input,
                start + 1,
                isStrictNumbers,
            );
            const consumed = packed >>> NumericPacking.CONSUMED_SHIFT;
            if (consumed === 0) {
                offset = input.indexOf("&", start);
            } else {
                if (last !== offset) {
                    result += input.slice(last, offset);
                }
                result += numericValue(packed & NumericPacking.CODE_POINT_MASK);
                last = offset + consumed;
                offset = nextOffset(input, last);
            }
            continue;
        }

        /*
         * Named entity. The (c0,c1) class lists every length a matching
         * name can have; probe `;` at each. A probe hit is fully
         * verified by `findSlot`; no scanning is needed. A `;` miss at
         * a legacy-marked length falls through to a direct legacy
         * lookup — legacy names need no terminator.
         */
        const bits =
            htmlLengthBits[
                (((c0 * 3) << 3) ^ input.charCodeAt(start + 1)) & 1023
            ];
        let probed = bits & 0x7f_ff;
        let legacyPacked = -1;
        while (probed !== 0) {
            /*
             * Shortest candidate first: only one length can carry the
             * terminating ';' (a ';' inside a longer candidate fails its
             * middle comparison), so the order is correctness-neutral —
             * and the most common entities are short.
             */
            const low = probed & -probed;
            probed ^= low;
            const length = 33 - Math.clz32(low);
            if (input.charCodeAt(start + length) === CharCodes.SEMI) {
                const slot = findSlotHtml(input, start, length);
                if (slot >= 0) {
                    if (last !== offset) {
                        result += input.slice(last, offset);
                    }
                    result += emitHtmlValue(htmlSlotValue[slot]);
                    last = start + length + 1;
                    offset = nextOffset(input, last);
                    probed = -1;
                    // eslint-disable-next-line unicorn/no-break-in-nested-loop -- hot path: this exits the probe loop on a match; extracting it into a function would add a per-entity call
                    break;
                }
            } else if (
                isLegacyAllowed &&
                ((bits >>> (length + 14)) & 1) !== 0
            ) {
                /*
                 * No ';' here, but this length is a legacy candidate.
                 * Record it and keep going: a longer exact match must
                 * win, and ascending order makes the last recorded
                 * candidate the longest legacy match.
                 */
                const slot = findSlotHtml(input, start, length);
                if (
                    slot >= 0 &&
                    (htmlLegacyBits[slot >> 3] & (1 << (slot & 7))) !== 0
                ) {
                    legacyPacked = (slot << 3) | length;
                }
            }
        }
        if (probed === -1) continue;

        if ((bits & 0x80_00) !== 0) {
            /*
             * This class contains names longer than 16 characters (24
             * classes in the HTML set). Find the run's end, then try
             * the long exact match; shorter lengths were probed above.
             */
            let index = start;
            const scanEnd = Math.min(inputLength, start + 32);
            while (index < scanEnd && isAlphaNumeric(input.charCodeAt(index))) {
                index++;
            }
            /*
             * The run's terminator (or 0 at end of input). Equivalent to the
             * last `char` the scan loop read: where they could differ (a full
             * 32-char run, or input end) the length/index guards below make
             * the value unobservable.
             */
            const char = index < inputLength ? input.charCodeAt(index) : 0;
            const length = index - start;
            if (
                char === CharCodes.SEMI &&
                index < inputLength &&
                (length - 17) >>> 0 <= 14
            ) {
                const slot = findSlotHtml(input, start, length);
                if (slot >= 0) {
                    if (last !== offset) {
                        result += input.slice(last, offset);
                    }
                    result += emitHtmlValue(htmlSlotValue[slot]);
                    last = index + 1;
                    offset = nextOffset(input, last);
                    continue;
                }
            }
            if (isLegacyAllowed) {
                const packed = legacyPacked;
                if (packed >= 0) {
                    const matchLength = packed & 7;
                    const next =
                        start + matchLength < inputLength
                            ? input.charCodeAt(start + matchLength)
                            : 0;
                    if (
                        mode !== DecodingMode.Attribute ||
                        !isEntityInAttributeInvalidEnd(next)
                    ) {
                        if (last !== offset) {
                            result += input.slice(last, offset);
                        }
                        result += emitHtmlValue(htmlSlotValue[packed >> 3]);
                        last = start + matchLength;
                        offset = nextOffset(input, last);
                        continue;
                    }
                }
            }
            offset =
                char === CharCodes.AMP
                    ? index
                    : input.indexOf("&", length === 0 ? start : index);
            continue;
        }

        if (isLegacyAllowed) {
            const packed = legacyPacked;
            if (packed >= 0) {
                const matchLength = packed & 7;
                const next =
                    start + matchLength < inputLength
                        ? input.charCodeAt(start + matchLength)
                        : 0;
                if (
                    mode !== DecodingMode.Attribute ||
                    !isEntityInAttributeInvalidEnd(next)
                ) {
                    if (last !== offset) {
                        result += input.slice(last, offset);
                    }
                    result += emitHtmlValue(htmlSlotValue[packed >> 3]);
                    last = start + matchLength;
                    offset = nextOffset(input, last);
                    continue;
                }
            }
        }
        offset = input.indexOf("&", start + 1);
    } while (offset >= 0);

    return result + input.slice(last);
}

/**
 * Decodes an HTML string.
 * @param htmlString The string to decode.
 * @param mode The decoding mode.
 * @returns The decoded string.
 */
export function decodeHTML(
    htmlString: string,
    mode: DecodingMode = DecodingMode.Legacy,
): string {
    return decodeHtmlText(htmlString, mode);
}

/**
 * Decodes an HTML string in an attribute.
 * @param htmlAttribute The string to decode.
 * @returns The decoded string.
 */
export function decodeHTMLAttribute(htmlAttribute: string): string {
    return decodeHtmlText(htmlAttribute, DecodingMode.Attribute);
}

/**
 * Decodes an HTML string, requiring all entities to be terminated by a
 * semicolon.
 * @param htmlString The string to decode.
 * @returns The decoded string.
 */
export function decodeHTMLStrict(htmlString: string): string {
    return decodeHtmlText(htmlString, DecodingMode.Strict);
}

/**
 * Decodes an XML string, requiring all entities to be terminated by a
 * semicolon.
 * @param xmlString The string to decode.
 * @returns The decoded string.
 */
export function decodeXML(xmlString: string): string {
    return decodeXmlText(xmlString);
}

const enum EntityDecoderState {
    EntityStart,
    NumericStart,
    NumericDecimal,
    NumericHex,
    NamedEntity,
}

/**
 * Producers for character reference errors as defined in the HTML spec.
 */
export interface EntityErrorProducer {
    missingSemicolonAfterCharacterReference(): void;
    absenceOfDigitsInNumericCharacterReference(
        consumedCharacters: number,
    ): void;
    validateNumericCharacterReference(code: number): void;
}

/**
 * Token decoder with support of writing partial entities; the shared base
 * of `HtmlEntityDecoder` and `XmlEntityDecoder`. Numeric entities are
 * identical in both document types and are handled here; named entities are
 * left to the subclasses.
 *
 * The decoder is driven by a tokenizer: after a `&`, write the following
 * input (possibly in chunks). `write` returns the number of characters
 * consumed once the entity is decided, or -1 while more input is needed.
 * Rejection may surface later than strictly possible (the decoder buffers
 * until a terminator or the name-length limit), but emitted code points,
 * consumed counts, and final return values are exact.
 */
abstract class EntityDecoderBase {
    /** The current state of the decoder. */
    protected state: number = EntityDecoderState.EntityStart;
    /** Characters that were consumed while parsing an entity. */
    protected consumed = 1;
    /** For numeric entities: the accumulated code point. */
    protected result = 0;
    /** Buffered name characters of a partial named entity. */
    protected pending = "";
    /** The mode in which the decoder is operating. */
    protected decodeMode: DecodingMode = DecodingMode.Strict;

    constructor(
        /**
         * The function that is called when a codepoint is decoded.
         *
         * For multi-byte named entities, this will be called multiple times,
         * with the second codepoint, and the same `consumed` value.
         * @param codepoint The decoded codepoint.
         * @param consumed The number of bytes consumed by the decoder.
         */
        protected readonly emitCodePoint: (
            cp: number,
            consumed: number,
        ) => void,
        /** An object that is used to produce errors. */
        protected readonly errors?: EntityErrorProducer | undefined,
    ) {}

    /**
     * Switches between the numeric decimal and hexadecimal states.
     *
     * Equivalent to the `Numeric character reference state` in the HTML spec.
     * @param input The string containing the entity (or a continuation of the entity).
     * @param offset The current offset.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    private stateNumericStart(input: string, offset: number): number {
        if (offset >= input.length) {
            return -1;
        }

        if ((input.charCodeAt(offset) | TO_LOWER_BIT) === CharCodes.LOWER_X) {
            this.state = EntityDecoderState.NumericHex;
            this.consumed += 1;
            return this.stateNumericHex(input, offset + 1);
        }

        this.state = EntityDecoderState.NumericDecimal;
        return this.stateNumericDecimal(input, offset);
    }

    /**
     * Parses a hexadecimal numeric entity.
     *
     * Equivalent to the `Hexadecimal character reference state` in the HTML spec.
     * @param input The string containing the entity (or a continuation of the entity).
     * @param offset The current offset.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    private stateNumericHex(input: string, offset: number): number {
        const inputLength = input.length;
        // Local accumulators; flushed before any exit.
        let { result, consumed } = this;
        let index = offset;
        while (index < inputLength) {
            const char = input.charCodeAt(index);
            if (isNumber(char)) {
                result = result * 16 + (char - CharCodes.ZERO);
            } else if (isHexadecimalCharacter(char)) {
                result =
                    result * 16 +
                    ((char | TO_LOWER_BIT) - CharCodes.LOWER_A + 10);
            } else {
                this.result = result;
                this.consumed = consumed;
                return this.emitNumericEntity(char, 3);
            }
            consumed += 1;
            index += 1;
        }
        this.result = result;
        this.consumed = consumed;
        return -1; // Incomplete entity
    }

    /**
     * Parses a decimal numeric entity.
     *
     * Equivalent to the `Decimal character reference state` in the HTML spec.
     * @param input The string containing the entity (or a continuation of the entity).
     * @param offset The current offset.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    private stateNumericDecimal(input: string, offset: number): number {
        const inputLength = input.length;
        // Local accumulators; flushed before any exit.
        let { result, consumed } = this;
        let index = offset;
        while (index < inputLength) {
            const digit = input.charCodeAt(index) - CharCodes.ZERO;
            if (digit >>> 0 > 9) {
                this.result = result;
                this.consumed = consumed;
                return this.emitNumericEntity(digit + CharCodes.ZERO, 2);
            }
            result = result * 10 + digit;
            consumed += 1;
            index += 1;
        }
        this.result = result;
        this.consumed = consumed;
        return -1; // Incomplete entity
    }

    /**
     * Validate and emit a numeric entity.
     *
     * Implements the logic from the `Hexadecimal character reference start
     * state` and `Numeric character reference end state` in the HTML spec.
     * @param lastCp The last code point of the entity. Used to see if the
     *               entity was terminated with a semicolon.
     * @param expectedLength The minimum number of characters that should be
     *                       consumed. Used to validate that at least one digit
     *                       was consumed.
     * @returns The number of characters that were consumed.
     */
    private emitNumericEntity(lastCp: number, expectedLength: number): number {
        // Ensure we consumed at least one digit.
        if (this.consumed <= expectedLength) {
            this.errors?.absenceOfDigitsInNumericCharacterReference(
                this.consumed,
            );
            return 0;
        }

        // Figure out if this is a legit end of the entity
        if (lastCp === CharCodes.SEMI) {
            this.consumed += 1;
        } else if (this.decodeMode === DecodingMode.Strict) {
            return 0;
        }

        this.emitCodePoint(replaceCodePoint(this.result), this.consumed);

        if (this.errors) {
            if (lastCp !== CharCodes.SEMI) {
                this.errors.missingSemicolonAfterCharacterReference();
            }
            this.errors.validateNumericCharacterReference(this.result);
        }

        return this.consumed;
    }

    /**
     * Resets the instance to make it reusable.
     * @param decodeMode Entity decoding mode to use.
     */
    startEntity(decodeMode: DecodingMode): void {
        this.decodeMode = decodeMode;
        this.state = EntityDecoderState.EntityStart;
        this.result = 0;
        this.consumed = 1;
        this.pending = "";
    }

    /**
     * Write an entity to the decoder. This can be called multiple times with partial entities.
     * If the entity is incomplete, the decoder will return -1.
     * @param input The string containing the entity (or a continuation of the entity).
     * @param offset The offset at which the entity begins. Should be 0 if this is not the first call.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    write(input: string, offset: number): number {
        switch (this.state) {
            case EntityDecoderState.EntityStart: {
                if (input.charCodeAt(offset) === CharCodes.NUM) {
                    this.state = EntityDecoderState.NumericStart;
                    this.consumed += 1;
                    return this.stateNumericStart(input, offset + 1);
                }
                this.state = EntityDecoderState.NamedEntity;
                return this.stateNamedEntity(input, offset);
            }

            case EntityDecoderState.NumericStart: {
                return this.stateNumericStart(input, offset);
            }

            case EntityDecoderState.NumericDecimal: {
                return this.stateNumericDecimal(input, offset);
            }

            case EntityDecoderState.NumericHex: {
                return this.stateNumericHex(input, offset);
            }

            default: {
                // NamedEntity — the only remaining state.
                return this.stateNamedEntity(input, offset);
            }
        }
    }

    /**
     * Decode a named entity.
     * @param input The string containing the entity (or a continuation of the entity).
     * @param offset The current offset.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    protected abstract stateNamedEntity(input: string, offset: number): number;

    /**
     * Resolve a named entity that was still incomplete when the input
     * ended.
     * @returns The number of characters that were consumed.
     */
    protected abstract endNamedEntity(): number;

    /**
     * Signal to the parser that the end of the input was reached.
     *
     * Remaining data will be emitted and relevant errors will be produced.
     * @returns The number of characters consumed.
     */
    end(): number {
        switch (this.state) {
            case EntityDecoderState.NamedEntity: {
                return this.endNamedEntity();
            }

            // Otherwise, emit a numeric entity if we have one.
            case EntityDecoderState.NumericDecimal: {
                return this.emitNumericEntity(0, 2);
            }

            case EntityDecoderState.NumericHex: {
                return this.emitNumericEntity(0, 3);
            }

            case EntityDecoderState.NumericStart: {
                this.errors?.absenceOfDigitsInNumericCharacterReference(
                    this.consumed,
                );
                return 0;
            }

            default: {
                // EntityStart — return 0.
                return 0;
            }
        }
    }
}

/**
 * Streaming decoder for HTML entities.
 *
 * When the entity fits inside the current chunk (the common case), the
 * lookup runs directly on the chunk via the same length-probe scheme as the
 * synchronous decoder; only chunk-boundary runs are buffered in `pending`.
 */
export class HtmlEntityDecoder extends EntityDecoderBase {
    /** Total name characters seen for the current named entity. */
    private runLength = 0;

    /**
     * Emit the replacement for a matched slot. Values are at most two
     * UTF-16 code units; like previous versions, each unit is emitted as
     * its own callback (surrogate halves included).
     * @param slot The matched slot.
     */
    private emitSlot(slot: number): void {
        const packed = htmlSlotValue[slot];
        const off = packed >> 2;
        this.emitCodePoint(htmlValues.charCodeAt(off), this.consumed);
        if ((packed & 3) !== 0) {
            this.emitCodePoint(htmlValues.charCodeAt(off + 1), this.consumed);
        }
    }

    override startEntity(decodeMode: DecodingMode): void {
        super.startEntity(decodeMode);
        this.runLength = 0;
    }

    protected stateNamedEntity(input: string, offset: number): number {
        const inputLength = input.length;

        if (this.runLength === 0 && offset + 17 <= inputLength) {
            /*
             * Fast path: all length probes are conclusive inside this
             * chunk. (Near the chunk end a probe miss could be a name
             * continuing in the next chunk, so fall through to buffering.)
             */
            const c0 = input.charCodeAt(offset);
            const pair = pairIndex(c0, input.charCodeAt(offset + 1));
            const bits = htmlLengthBits[pair];
            let probed = bits & 0x7f_ff;
            while (probed !== 0) {
                /*
                 * Shortest candidate first: only one length can carry the
                 * terminating ';' (a ';' inside a longer candidate fails its
                 * middle comparison), so the order is correctness-neutral —
                 * and the most common entities are short. Legacy matches are
                 * resolved after the loop, preserving exact-match
                 * precedence.
                 */
                const low = probed & -probed;
                probed ^= low;
                const length = 33 - Math.clz32(low);
                if (input.charCodeAt(offset + length) === CharCodes.SEMI) {
                    const slot = findSlotHtml(input, offset, length);
                    if (slot >= 0) {
                        const consumed = (this.consumed = length + 2);
                        const packed = htmlSlotValue[slot];
                        const off = packed >> 2;
                        this.emitCodePoint(
                            htmlValues.charCodeAt(off),
                            consumed,
                        );
                        if ((packed & 3) !== 0) {
                            this.emitCodePoint(
                                htmlValues.charCodeAt(off + 1),
                                consumed,
                            );
                        }
                        return consumed;
                    }
                }
            }
            if ((bits & 0x80_00) === 0) {
                if (this.decodeMode !== DecodingMode.Strict) {
                    const packed = findLegacySlot(input, offset, 31);
                    if (packed >= 0) {
                        const matchLength = packed & 7;
                        const next = input.charCodeAt(offset + matchLength);
                        if (
                            this.decodeMode === DecodingMode.Attribute &&
                            isEntityInAttributeInvalidEnd(next)
                        ) {
                            return 0;
                        }
                        this.consumed = matchLength + 1;
                        this.emitSlot(packed >> 3);
                        this.errors?.missingSemicolonAfterCharacterReference();
                        return this.consumed;
                    }
                }
                // No long names in this class: the probes were exhaustive.
                return 0;
            }
        }

        // Slow path: scan the run, buffering across chunk boundaries.
        let index = offset;
        let terminator = -1;
        while (index < inputLength) {
            const char = input.charCodeAt(index);
            if (!isAlphaNumeric(char)) {
                terminator = char;
                break;
            }
            index++;
        }
        const part = index - offset;
        const runLength = this.runLength + part;
        if (terminator < 0) {
            // Chunk ended inside the run; buffer what lookups may need.
            if (this.runLength < 32 && part > 0) {
                this.pending += input.slice(
                    offset,
                    Math.min(index, offset + 32 - this.runLength),
                );
            }
            this.runLength = runLength;
            return -1;
        }

        if (terminator === CharCodes.SEMI && (runLength - 2) >>> 0 <= 29) {
            const slot =
                this.runLength === 0
                    ? findSlotHtml(input, offset, runLength)
                    : findSlotHtml(
                          this.pending + input.slice(offset, index),
                          0,
                          runLength,
                      );
            if (slot >= 0) {
                this.consumed = runLength + 2;
                this.emitSlot(slot);
                return this.consumed;
            }
        }

        if (this.decodeMode !== DecodingMode.Strict && runLength >= 2) {
            const name =
                this.runLength === 0
                    ? input
                    : this.pending + input.slice(offset, index);
            const nameStart = this.runLength === 0 ? offset : 0;
            const packed = findLegacySlot(name, nameStart, runLength);
            if (packed >= 0) {
                const matchLength = packed & 7;
                const next =
                    matchLength < runLength
                        ? name.charCodeAt(nameStart + matchLength)
                        : terminator;
                if (
                    this.decodeMode === DecodingMode.Attribute &&
                    isEntityInAttributeInvalidEnd(next)
                ) {
                    return 0;
                }
                this.consumed = matchLength + 1;
                this.emitSlot(packed >> 3);
                this.errors?.missingSemicolonAfterCharacterReference();
                return this.consumed;
            }
        }

        return 0;
    }

    protected endNamedEntity(): number {
        // Emit the longest legacy match in the buffered run, if any.
        if (this.decodeMode === DecodingMode.Strict || this.runLength < 2) {
            return 0;
        }
        const packed = findLegacySlot(
            this.pending,
            0,
            Math.min(this.pending.length, this.runLength),
        );
        if (packed < 0) return 0;
        if (
            this.decodeMode === DecodingMode.Attribute &&
            (packed & 7) < this.runLength
        ) {
            return 0;
        }
        this.consumed = (packed & 7) + 1;
        this.emitSlot(packed >> 3);
        this.errors?.missingSemicolonAfterCharacterReference();
        return this.consumed;
    }
}

/**
 * Streaming decoder for XML entities: the five predefined named entities
 * plus numeric character references.
 */
export class XmlEntityDecoder extends EntityDecoderBase {
    protected stateNamedEntity(input: string, offset: number): number {
        const inputLength = input.length;

        if (this.pending.length === 0 && offset + 5 <= inputLength) {
            // Fast path: all five patterns are decided within five chars.
            const packed = matchXmlEntity(input, offset);
            if (packed < 0) return 0;
            const consumed = (this.consumed = (packed >> 7) + 1);
            this.emitCodePoint(packed & 127, consumed);
            return consumed;
        }

        // Slow path: scan the run, buffering across chunk boundaries.
        let index = offset;
        while (index < inputLength) {
            const char = input.charCodeAt(index);
            if (!isAlphaNumeric(char)) {
                if (char !== CharCodes.SEMI) return 0;
                const name = this.pending + input.slice(offset, index);
                const cp = xmlCodePoint(name);
                if (cp < 0) return 0;
                this.consumed = name.length + 2;
                this.emitCodePoint(cp, this.consumed);
                return this.consumed;
            }
            index++;
        }

        /*
         * Chunk ended inside the name. Five buffered characters are enough
         * to decide every entity; a truncated longer run keeps a name
         * length that can never match.
         */
        if (this.pending.length < 5) {
            this.pending += input.slice(
                offset,
                Math.min(index, offset + 5 - this.pending.length),
            );
        }
        return -1;
    }

    protected endNamedEntity(): number {
        // XML has no legacy entities; an unterminated name never matches.
        return 0;
    }
}

export { replaceCodePoint } from "./decode-codepoint.js";
