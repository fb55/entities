import {
    codePointToString,
    replaceCodePoint,
    replaceCodePointXML,
} from "./decode-codepoint.js";
import { htmlDecodeData } from "./generated/decode-data-html.js";
import {
    BUCKET_HASH_1,
    BUCKET_HASH_2,
    CHAR_REMAP,
    type DecodeData,
    initDecodeData,
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
    LOWER_M = 109, // "m"
    LOWER_O = 111, // "o"
    LOWER_P = 112, // "p"
    LOWER_Q = 113, // "q"
    LOWER_S = 115, // "s"
    LOWER_T = 116, // "t"
    LOWER_U = 117, // "u"
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

/** Decode data for HTML entities. */
const htmlDecode: DecodeData = /* #__PURE__ */ initDecodeData(htmlDecodeData);

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
const htmlMiddles = /* #__PURE__ */ ((): Uint32Array => htmlDecode.middles)();
const htmlLegacyBits = /* #__PURE__ */ ((): Uint8Array =>
    htmlDecode.legacyBits)();
/** Hoisted for the specialized HTML cores; see `emitHtmlValue`. */
const htmlSlotValue = /* #__PURE__ */ ((): Uint16Array =>
    htmlDecode.slotValue)();
const htmlValues = /* #__PURE__ */ ((): string => htmlDecode.values)();

/**
 * The replacement string for a packed `slotValue` entry. Most values need
 * just one UTF-16 code unit.
 * @param packed `(offset << 2) | (length - 1)` from `htmlSlotValue`.
 */
function emitHtmlValue(packed: number): string {
    const off = packed >> 2;
    return (packed & 3) === 0
        ? htmlValues.charAt(off)
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
            (length <= 4 || isMidMatchHtml(slot, text, start, length))
        ) {
            return slot;
        }
        if (
            htmlKeys[slot + 1] === key &&
            (length <= 4 || isMidMatchHtml(slot + 1, text, start, length))
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
 * the length. Names of length at most four are accepted by the caller.
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
    let wordIndex = htmlSlotMidOff[slot];
    let index = start + 2;
    const end = start + length - 2;
    while (index + 1 < end) {
        if (
            (text.charCodeAt(index) | (text.charCodeAt(index + 1) << 16)) !==
            htmlMiddles[wordIndex++]
        )
            return false;
        index += 2;
    }
    return (
        index === end ||
        text.charCodeAt(index) === (htmlMiddles[wordIndex] & 0xff_ff)
    );
}

/**
 * `parseNumericEntity` packs its two results into one integer:
 * `(consumed << CONSUMED_SHIFT) | codePoint`. The code point occupies the low
 * 21 bits (max 0x110000, clamped before packing); `consumed` takes the upper
 * 11 bits and is read back with `>>> CONSUMED_SHIFT`, so the sign bit set by a
 * large `consumed` is harmless. The maximum consumed field is reserved for
 * long references, whose full length is stored in `longNumericConsumed`.
 * A zero return means "no numeric entity".
 */
const enum NumericPacking {
    CONSUMED_SHIFT = 21,
    CODE_POINT_MASK = 0x1f_ff_ff,
    CONSUMED_OVERFLOW = 0x7_ff,
}

/** Full length, including `&`, when the packed consumed field overflows. */
let longNumericConsumed = 0;

/**
 * Recover the consumed count before the next numeric parse can overwrite
 * `longNumericConsumed`. This avoids allocating a tuple for each reference.
 * @param packed Packed result of `parseNumericEntity`.
 */
function unpackConsumed(packed: number): number {
    const consumed = packed >>> NumericPacking.CONSUMED_SHIFT;
    return consumed === NumericPacking.CONSUMED_OVERFLOW
        ? longNumericConsumed
        : consumed;
}

/** ASCII digit values; 0xff marks characters outside the hexadecimal range. */
const numericDigits: Uint8Array = /* #__PURE__ */ ((): Uint8Array => {
    const digits = new Uint8Array(128).fill(0xff);
    for (let digit = 0; digit < 10; digit++) {
        digits[CharCodes.ZERO + digit] = digit;
    }
    for (let digit = 0; digit < 6; digit++) {
        digits[CharCodes.UPPER_A + digit] = digit + 10;
        digits[CharCodes.LOWER_A + digit] = digit + 10;
    }
    return digits;
})();

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
            if (char >= 128) break;
            const digit = numericDigits[char];
            if (digit <= 15) {
                codePoint = codePoint * 16 + digit;
                index++;
            } else {
                break;
            }
        }
    } else {
        digitsStart = index;
        while (index < inputLength) {
            const char = input.charCodeAt(index);
            if (char >= 128) break;
            const digit = numericDigits[char];
            if (digit <= 9) {
                codePoint = codePoint * 10 + digit;
                index++;
            } else {
                break;
            }
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
    if (consumed >= NumericPacking.CONSUMED_OVERFLOW) {
        // eslint-disable-next-line unicorn/no-top-level-assignment-in-function -- deliberate side channel, read immediately by unpackConsumed
        longNumericConsumed = consumed;
        consumed = NumericPacking.CONSUMED_OVERFLOW;
    }
    return (consumed << NumericPacking.CONSUMED_SHIFT) | codePoint;
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
 * Match a class containing long names without probing all its shorter lengths.
 * The 32-character window bounds the scan even for invalid or unterminated runs.
 * Returns `(slot << 6) | consumed`, excluding the `&`, or -1 on a miss.
 * @param input Input containing the candidate name.
 * @param start Start of the name.
 * @param mode Decoding mode, including the rules for legacy matches.
 */
function findLongClassMatch(
    input: string,
    start: number,
    mode: DecodingMode,
): number {
    const length = input.slice(start, start + 32).indexOf(";");
    if ((length - 2) >>> 0 <= 29) {
        const slot = findSlotHtml(input, start, length);
        if (slot >= 0) return (slot << 6) | (length + 1);
    }
    if (mode !== DecodingMode.Strict) {
        const packed = findLegacySlot(
            input,
            start,
            Math.min(31, input.length - start),
        );
        if (packed >= 0) {
            const length = packed & 7;
            if (
                mode !== DecodingMode.Attribute ||
                start + length >= input.length ||
                !isEntityInAttributeInvalidEnd(input.charCodeAt(start + length))
            )
                return ((packed >> 3) << 6) | length;
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
    /*
     * Direct char-code compares: `startsWith` costs a builtin call per
     * probe, measured ~10% of entity-dense XML decode. Loads stay inside
     * the cases so the miss path (`default`) pays nothing.
     */
    switch (input.charCodeAt(start)) {
        case CharCodes.LOWER_L: {
            return input.charCodeAt(start + 1) === CharCodes.LOWER_T &&
                input.charCodeAt(start + 2) === CharCodes.SEMI
                ? (3 << 7) | 0x3c
                : -1;
        }
        case CharCodes.LOWER_G: {
            return input.charCodeAt(start + 1) === CharCodes.LOWER_T &&
                input.charCodeAt(start + 2) === CharCodes.SEMI
                ? (3 << 7) | 0x3e
                : -1;
        }
        case CharCodes.LOWER_A: {
            const c1 = input.charCodeAt(start + 1);
            const c2 = input.charCodeAt(start + 2);
            if (
                c1 === CharCodes.LOWER_M &&
                c2 === CharCodes.LOWER_P &&
                input.charCodeAt(start + 3) === CharCodes.SEMI
            ) {
                return (4 << 7) | 0x26;
            }
            return c1 === CharCodes.LOWER_P &&
                c2 === CharCodes.LOWER_O &&
                input.charCodeAt(start + 3) === CharCodes.LOWER_S &&
                input.charCodeAt(start + 4) === CharCodes.SEMI
                ? (5 << 7) | 0x27
                : -1;
        }
        case CharCodes.LOWER_Q: {
            return input.charCodeAt(start + 1) === CharCodes.LOWER_U &&
                input.charCodeAt(start + 2) === CharCodes.LOWER_O &&
                input.charCodeAt(start + 3) === CharCodes.LOWER_T &&
                input.charCodeAt(start + 4) === CharCodes.SEMI
                ? (5 << 7) | 0x22
                : -1;
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
    if (last >= input.length) return -1;
    return input.charCodeAt(last) === CharCodes.AMP
        ? last
        : input.indexOf("&", last);
}

/**
 * Synchronous HTML decoder, shared by all three decoding modes.
 * @param input String to decode.
 * @param mode Decoding mode for named entities.
 */
function decodeHtmlText(input: string, mode: DecodingMode): string {
    const isLegacyAllowed = mode !== DecodingMode.Strict;
    let offset = input.indexOf("&");
    if (offset < 0) return input;
    const inputLength = input.length;
    let result = "";
    let last = 0;
    do {
        const start = offset + 1;
        if (start + 1 >= inputLength) break;
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
                !isLegacyAllowed,
            );
            const consumed = unpackConsumed(packed);
            if (consumed === 0) {
                offset = input.indexOf("&", start);
            } else {
                if (last !== offset) {
                    result += input.slice(last, offset);
                }
                result += codePointToString(
                    packed & NumericPacking.CODE_POINT_MASK,
                );
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
        const bits = htmlLengthBits[pairIndex(c0, input.charCodeAt(start + 1))];
        if ((bits & 0x80_00) !== 0) {
            const packed = findLongClassMatch(input, start, mode);
            if (packed >= 0) {
                if (last !== offset) result += input.slice(last, offset);
                result += emitHtmlValue(htmlSlotValue[packed >> 6]);
                last = start + (packed & 63);
                offset = nextOffset(input, last);
            } else {
                offset = input.indexOf("&", start);
            }
            continue;
        }
        let probed = bits & 0x7f_ff;
        /*
         * Slot in bits 6+, semicolon in bit 5, consumed name span in bits 0-4.
         * This path only handles names up to 16 characters, plus their ';'.
         */
        let matched = -1;
        while (probed !== 0) {
            const low = probed & -probed;
            probed ^= low;
            const length = 33 - Math.clz32(low);
            const end = start + length;
            // Longer probes cannot match either; lengths are ascending.
            // eslint-disable-next-line unicorn/no-break-in-nested-loop -- keep the bounded probe loop inline
            if (end > inputLength) break;
            const isTerminated =
                end < inputLength && input.charCodeAt(end) === CharCodes.SEMI;
            if (
                !(
                    isTerminated ||
                    (isLegacyAllowed && ((bits >>> (length + 14)) & 1) !== 0)
                )
            )
                // eslint-disable-next-line unicorn/no-break-in-nested-loop -- skip impossible candidates in the inline probe loop
                continue;
            // Share the lookup call site, including after legacy-only inputs.
            const slot = findSlotHtml(input, start, length);
            // eslint-disable-next-line unicorn/no-break-in-nested-loop -- skip failed candidates in the inline probe loop
            if (slot < 0) continue;
            if (isTerminated) {
                matched = (slot << 6) | 32 | (length + 1);
                // eslint-disable-next-line unicorn/no-break-in-nested-loop -- an exact match ends the probe loop
                break;
            }
            if ((htmlLegacyBits[slot >> 3] & (1 << (slot & 7))) !== 0) {
                matched = (slot << 6) | length;
            }
        }
        if (matched >= 0) {
            const length = matched & 31;
            if (
                (matched & 32) !== 0 ||
                mode !== DecodingMode.Attribute ||
                start + length >= inputLength ||
                !isEntityInAttributeInvalidEnd(input.charCodeAt(start + length))
            ) {
                if (last !== offset) result += input.slice(last, offset);
                result += emitHtmlValue(htmlSlotValue[matched >> 6]);
                last = start + length;
                offset = nextOffset(input, last);
                continue;
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
    let offset = xmlString.indexOf("&");
    if (offset < 0) return xmlString;
    let lastIndex = 0;
    let result = "";
    do {
        const start = offset + 1;
        if (start + 1 >= xmlString.length) break;
        let consumed = 0;
        let value = "";
        const c1 = xmlString.charCodeAt(start);
        if (c1 === CharCodes.NUM) {
            const packed = parseNumericEntity(xmlString, start + 1, true);
            consumed = unpackConsumed(packed);
            if (consumed !== 0) {
                const codePoint = packed & NumericPacking.CODE_POINT_MASK;
                value =
                    (codePoint - 1) >>> 0 < 0xd7_ff
                        ? String.fromCharCode(codePoint)
                        : String.fromCodePoint(replaceCodePointXML(codePoint));
            }
        } else {
            /* eslint-disable unicorn/no-break-in-nested-loop -- Keep XML name dispatch inline with the decode loop. */
            switch (c1) {
                // &lt; / &gt;
                case 0x6c:
                case 0x67: {
                    if (
                        start + 2 < xmlString.length &&
                        xmlString.charCodeAt(start + 1) === 0x74 &&
                        xmlString.charCodeAt(start + 2) === CharCodes.SEMI
                    ) {
                        consumed = 4;
                        value = c1 === 0x6c ? "<" : ">";
                    }
                    break;
                }
                // &amp; / &apos;
                case 0x61: {
                    const c2 = xmlString.charCodeAt(start + 1);
                    if (
                        start + 3 < xmlString.length &&
                        c2 === 0x6d &&
                        xmlString.charCodeAt(start + 2) === 0x70 &&
                        xmlString.charCodeAt(start + 3) === CharCodes.SEMI
                    ) {
                        consumed = 5;
                        value = "&";
                    } else if (
                        start + 4 < xmlString.length &&
                        c2 === 0x70 &&
                        xmlString.charCodeAt(start + 2) === 0x6f &&
                        xmlString.charCodeAt(start + 3) === 0x73 &&
                        xmlString.charCodeAt(start + 4) === CharCodes.SEMI
                    ) {
                        consumed = 6;
                        value = "'";
                    }
                    break;
                }
                // &quot;
                case 0x71: {
                    if (
                        start + 4 < xmlString.length &&
                        xmlString.charCodeAt(start + 1) === 0x75 &&
                        xmlString.charCodeAt(start + 2) === 0x6f &&
                        xmlString.charCodeAt(start + 3) === 0x74 &&
                        xmlString.charCodeAt(start + 4) === CharCodes.SEMI
                    ) {
                        consumed = 6;
                        value = '"';
                    }
                    break;
                }
            }
            /* eslint-enable unicorn/no-break-in-nested-loop */
        }
        if (consumed > 0) {
            if (lastIndex < offset)
                result += xmlString.slice(lastIndex, offset);
            result += value;
            offset = lastIndex = offset + consumed;
        } else {
            offset = start;
        }
        /*
         * Adjacent entities (`&x;&y;`) are common in entity-dense input;
         * checking the single character at `lastIndex` first skips the
         * `indexOf` call (and its per-call overhead) for that case.
         */
        offset =
            offset < xmlString.length &&
            xmlString.charCodeAt(offset) === CharCodes.AMP
                ? offset
                : xmlString.indexOf("&", offset);
    } while (offset >= 0);
    return result + xmlString.slice(lastIndex);
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
    /**
     * Validate the accumulated numeric value, before Unicode replacement.
     * Values beyond the JavaScript number range are positive infinity.
     */
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
    /** Accumulated numeric code point, or a packed partial XML name. */
    protected result = 0;
    /** The mode in which the decoder is operating. */
    protected decodeMode: DecodingMode = DecodingMode.Strict;

    /** Replacement rules for numeric character references. */
    protected readonly replaceNumericCodePoint: (codePoint: number) => number =
        replaceCodePoint;

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
            const digit = numericDigits[char];
            if (digit <= 15) {
                result = result * 16 + digit;
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

        this.emitCodePoint(
            this.replaceNumericCodePoint(this.result),
            this.consumed,
        );

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
 * synchronous decoder; chunk-boundary runs use a reusable character buffer.
 */
export class HtmlEntityDecoder extends EntityDecoderBase {
    /** Total name characters seen for the current named entity. */
    private runLength = 0;

    /** Reused for partial names; the 32nd character rules out an exact match. */
    private readonly nameBuffer = new Uint16Array(32);

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
            if ((bits & 0x80_00) !== 0 && offset + 32 <= inputLength) {
                const packed = findLongClassMatch(
                    input,
                    offset,
                    this.decodeMode,
                );
                if (packed >= 0) {
                    const length = packed & 63;
                    this.consumed = length + 1;
                    this.emitSlot(packed >> 6);
                    if (
                        input.charCodeAt(offset + length - 1) !== CharCodes.SEMI
                    ) {
                        this.errors?.missingSemicolonAfterCharacterReference();
                    }
                    return this.consumed;
                }
                // The window decides every exact or legacy candidate.
                return 0;
            }
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
                        this.consumed = length + 2;
                        this.emitSlot(slot);
                        return this.consumed;
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

        // A 32nd name character rules out every exact HTML match.
        let index = offset;
        let { runLength } = this;
        let terminator = -1;
        const scanEnd = Math.min(inputLength, offset + 32 - runLength);
        while (index < scanEnd) {
            const char = input.charCodeAt(index);
            if (!isAlphaNumeric(char)) {
                terminator = char;
                break;
            }
            this.nameBuffer[runLength++] = char;
            index++;
        }
        if (terminator < 0 && runLength < 32) {
            this.runLength = runLength;
            return -1;
        }
        if (terminator === CharCodes.SEMI && (runLength - 2) >>> 0 <= 29) {
            const slot = findBufferedHtmlSlot(this.nameBuffer, runLength);
            if (slot >= 0) {
                this.consumed = runLength + 2;
                this.emitSlot(slot);
                return this.consumed;
            }
        }
        if (this.decodeMode !== DecodingMode.Strict && runLength >= 2) {
            const packed = findBufferedLegacySlot(this.nameBuffer, runLength);
            if (packed >= 0) {
                const length = packed & 7;
                const next =
                    length < runLength ? this.nameBuffer[length] : terminator;
                if (
                    this.decodeMode === DecodingMode.Attribute &&
                    isEntityInAttributeInvalidEnd(next)
                )
                    return 0;
                this.consumed = length + 1;
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
        const packed = findBufferedLegacySlot(this.nameBuffer, this.runLength);
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
 * Find a buffered name. Its characters were already checked as ASCII
 * alphanumerics while scanning, so no outer-character range check is needed.
 * @param buffer Reusable character buffer.
 * @param length Number of characters to match.
 */
function findBufferedHtmlSlot(buffer: Uint16Array, length: number): number {
    const key =
        (buffer[0] << 25) |
        (buffer[1] << 18) |
        (buffer[length - 2] << 11) |
        (CHAR_REMAP[buffer[length - 1]] << 5) |
        length;
    let slot =
        2 * (((Math.imul(key, BUCKET_HASH_1) >>> 16) * htmlBuckets) >>> 16);
    for (let attempt = 0; ; attempt++) {
        if (
            htmlKeys[slot] === key &&
            (length <= 4 || isBufferedMiddle(slot, buffer, length))
        )
            return slot;
        if (
            htmlKeys[slot + 1] === key &&
            (length <= 4 || isBufferedMiddle(slot + 1, buffer, length))
        )
            return slot + 1;
        if (attempt === 1) return -1;
        slot =
            2 * (((Math.imul(key, BUCKET_HASH_2) >>> 16) * htmlBuckets) >>> 16);
    }
}

function isBufferedMiddle(
    slot: number,
    buffer: Uint16Array,
    length: number,
): boolean {
    let wordIndex = htmlSlotMidOff[slot];
    let index = 2;
    const end = length - 2;
    while (index + 1 < end) {
        if (
            (buffer[index] | (buffer[index + 1] << 16)) !==
            htmlMiddles[wordIndex++]
        )
            return false;
        index += 2;
    }
    return (
        index === end || buffer[index] === (htmlMiddles[wordIndex] & 0xff_ff)
    );
}

/**
 * Find the longest legacy name in the buffer, packed as `(slot << 3) | length`.
 * @param buffer Reusable character buffer.
 * @param length Number of buffered characters.
 */
function findBufferedLegacySlot(buffer: Uint16Array, length: number): number {
    let legacy = (htmlLengthBits[pairIndex(buffer[0], buffer[1])] >>> 16) & 31;
    while (legacy !== 0) {
        const top = 31 - Math.clz32(legacy);
        legacy ^= 1 << top;
        if (top + 2 > length) continue;
        const slot = findBufferedHtmlSlot(buffer, top + 2);
        if (slot >= 0 && (htmlLegacyBits[slot >> 3] & (1 << (slot & 7))) !== 0)
            return (slot << 3) | (top + 2);
    }
    return -1;
}

/**
 * Match an XML name packed in seven-bit groups, or return -1.
 * @param name Packed name accumulated across chunks.
 */
function xmlCodePoint(name: number): number {
    switch (name) {
        case 0x18_76_f0: {
            // "amp"
            return 0x26;
        }
        case 0xc_3c_37_f3: {
            // "apos"
            return 0x27;
        }
        case 0x33_f4: {
            // "gt"
            return 0x3e;
        }
        case 0x36_74: {
            // "lt"
            return 0x3c;
        }
        case 0xe_3d_77_f4: {
            // "quot"
            return 0x22;
        }
        default: {
            return -1;
        }
    }
}

/**
 * Streaming decoder for XML entities: the five predefined named entities
 * plus numeric character references.
 */
export class XmlEntityDecoder extends EntityDecoderBase {
    protected override readonly replaceNumericCodePoint: (
        codePoint: number,
    ) => number = replaceCodePointXML;

    protected stateNamedEntity(input: string, offset: number): number {
        const inputLength = input.length;
        if (this.consumed === 1 && offset + 5 <= inputLength) {
            // Fast path: all five patterns are decided within five chars.
            const packed = matchXmlEntity(input, offset);
            if (packed < 0) return 0;
            const consumed = (this.consumed = (packed >> 7) + 1);
            this.emitCodePoint(packed & 127, consumed);
            return consumed;
        }

        // XML names need at most four seven-bit characters, fitting in 28 bits.
        let { result, consumed } = this;
        for (let index = offset; index < inputLength; index++) {
            const char = input.charCodeAt(index);
            if (char === CharCodes.SEMI) {
                const codePoint = xmlCodePoint(result);
                if (codePoint < 0) return 0;
                this.consumed = consumed + 1;
                this.emitCodePoint(codePoint, this.consumed);
                return this.consumed;
            }
            if (consumed >= 5 || (char - CharCodes.LOWER_A) >>> 0 > 25)
                return 0;
            result = (result << 7) | char;
            consumed++;
        }
        this.result = result;
        this.consumed = consumed;
        return -1;
    }

    protected endNamedEntity(): number {
        // XML has no legacy entities; an unterminated name never matches.
        return 0;
    }
}

export { replaceCodePoint, replaceCodePointXML } from "./decode-codepoint.js";
