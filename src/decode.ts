import { fromCodePoint, replaceCodePoint } from "./decode-codepoint.js";
import { htmlDecodeTree } from "./generated/decode-data-html.js";
import { xmlDecodeTree } from "./generated/decode-data-xml.js";
import { BinTrieFlags } from "./internal/bin-trie-flags.js";

const enum CharCodes {
    NUM = 35, // "#"
    SEMI = 59, // ";"
    EQUALS = 61, // "="
    ZERO = 48, // "0"
    NINE = 57, // "9"
    LOWER_A = 97, // "a"
    LOWER_F = 102, // "f"
    LOWER_X = 120, // "x"
    LOWER_Z = 122, // "z"
    UPPER_A = 65, // "A"
    UPPER_F = 70, // "F"
    UPPER_Z = 90, // "Z"
}

/** Bit that needs to be set to convert an upper case ASCII character to lower case */
const TO_LOWER_BIT = 0b10_0000;

function isNumber(code: number): boolean {
    return code >= CharCodes.ZERO && code <= CharCodes.NINE;
}

function isHexadecimalCharacter(code: number): boolean {
    return (
        (code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_F) ||
        (code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_F)
    );
}

function isAsciiAlphaNumeric(code: number): boolean {
    return (
        (code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_Z) ||
        (code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_Z) ||
        isNumber(code)
    );
}

/**
 * Checks if the given character is a valid end character for an entity in an attribute.
 *
 * Attribute values that aren't terminated properly aren't parsed, and shouldn't lead to a parser error.
 * See the example in https://html.spec.whatwg.org/multipage/parsing.html#named-character-reference-state
 */
function isEntityInAttributeInvalidEnd(code: number): boolean {
    return code === CharCodes.EQUALS || isAsciiAlphaNumeric(code);
}

const enum EntityDecoderState {
    EntityStart,
    NumericStart,
    NumericDecimal,
    NumericHex,
    NamedEntity,
}

export enum DecodingMode {
    /** Entities in text nodes that can end with any character. */
    Legacy = 0,
    /** Only allow entities terminated with a semicolon. */
    Strict = 1,
    /** Entities in attributes have limitations on ending characters. */
    Attribute = 2,
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
 * Token decoder with support of writing partial entities.
 */
export class EntityDecoder {
    constructor(
        /** The tree used to decode entities. */
        // biome-ignore lint/correctness/noUnusedPrivateClassMembers: False positive
        private readonly decodeTree: Uint16Array,
        /**
         * The function that is called when a codepoint is decoded.
         *
         * For multi-byte named entities, this will be called multiple times,
         * with the second codepoint, and the same `consumed` value.
         *
         * @param codepoint The decoded codepoint.
         * @param consumed The number of bytes consumed by the decoder.
         */
        private readonly emitCodePoint: (cp: number, consumed: number) => void,
        /** An object that is used to produce errors. */
        private readonly errors?: EntityErrorProducer | undefined,
    ) {}

    /** The current state of the decoder. */
    private state = EntityDecoderState.EntityStart;
    /** Characters that were consumed while parsing an entity. */
    private consumed = 1;
    /**
     * The result of the entity.
     *
     * Either the result index of a numeric entity, or the codepoint of a
     * numeric entity.
     */
    private result = 0;

    /** The current index in the decode tree. */
    private treeIndex = 0;
    /** The number of characters that were consumed in excess. */
    private excess = 1;
    /** The mode in which the decoder is operating. */
    private decodeMode = DecodingMode.Strict;

    /** Resets the instance to make it reusable. */
    startEntity(decodeMode: DecodingMode): void {
        this.decodeMode = decodeMode;
        this.state = EntityDecoderState.EntityStart;
        this.result = 0;
        this.treeIndex = 0;
        this.excess = 1;
        this.consumed = 1;
    }

    /**
     * Write an entity to the decoder. This can be called multiple times with partial entities.
     * If the entity is incomplete, the decoder will return -1.
     *
     * Mirrors the implementation of `getDecoder`, but with the ability to stop decoding if the
     * entity is incomplete, and resume when the next string is written.
     *
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

            case EntityDecoderState.NamedEntity: {
                return this.stateNamedEntity(input, offset);
            }
        }
    }

    /**
     * Switches between the numeric decimal and hexadecimal states.
     *
     * Equivalent to the `Numeric character reference state` in the HTML spec.
     *
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
     * Equivalent to the `Hexademical character reference state` in the HTML spec.
     *
     * @param input The string containing the entity (or a continuation of the entity).
     * @param offset The current offset.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    private stateNumericHex(input: string, offset: number): number {
        while (offset < input.length) {
            const char = input.charCodeAt(offset);
            if (isNumber(char) || isHexadecimalCharacter(char)) {
                // Convert hex digit to value (0-15); 'a'/'A' -> 10.
                const digit =
                    char <= CharCodes.NINE
                        ? char - CharCodes.ZERO
                        : (char | TO_LOWER_BIT) - CharCodes.LOWER_A + 10;
                this.result = this.result * 16 + digit;
                this.consumed++;
                offset++;
            } else {
                return this.emitNumericEntity(char, 3);
            }
        }
        return -1; // Incomplete entity
    }

    /**
     * Parses a decimal numeric entity.
     *
     * Equivalent to the `Decimal character reference state` in the HTML spec.
     *
     * @param input The string containing the entity (or a continuation of the entity).
     * @param offset The current offset.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    private stateNumericDecimal(input: string, offset: number): number {
        while (offset < input.length) {
            const char = input.charCodeAt(offset);
            if (isNumber(char)) {
                this.result = this.result * 10 + (char - CharCodes.ZERO);
                this.consumed++;
                offset++;
            } else {
                return this.emitNumericEntity(char, 2);
            }
        }
        return -1; // Incomplete entity
    }

    /**
     * Validate and emit a numeric entity.
     *
     * Implements the logic from the `Hexademical character reference start
     * state` and `Numeric character reference end state` in the HTML spec.
     *
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
     * Parses a named entity.
     *
     * Equivalent to the `Named character reference state` in the HTML spec.
     *
     * @param input The string containing the entity (or a continuation of the entity).
     * @param offset The current offset.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    private stateNamedEntity(input: string, offset: number): number {
        const { decodeTree } = this;
        let current = decodeTree[this.treeIndex];
        // The length is the number of bytes of the value, including the current byte.
        let valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;

        while (offset < input.length) {
            // Handle compact runs (possibly inline): valueLength == 0 and SEMI_REQUIRED bit set.
            if (valueLength === 0 && (current & BinTrieFlags.FLAG13) !== 0) {
                const runLength =
                    (current & BinTrieFlags.BRANCH_LENGTH) >> 7; /* 2..63 */
                const firstChar = current & BinTrieFlags.JUMP_TABLE;
                // Fast-fail if we don't have enough remaining input for the full run (incomplete entity)
                if (offset + runLength > input.length) return -1;
                // Verify first char
                if (input.charCodeAt(offset) !== firstChar) {
                    return this.result === 0
                        ? 0
                        : this.emitNotTerminatedNamedEntity();
                }
                offset++;
                this.excess++;
                // Remaining characters after the first
                const remaining = runLength - 1;
                // Iterate over packed 2-char words
                for (let runPos = 1; runPos < runLength; runPos += 2) {
                    const packedWord =
                        decodeTree[this.treeIndex + 1 + ((runPos - 1) >> 1)];
                    const low = packedWord & 0xff;
                    if (input.charCodeAt(offset) !== low) {
                        return this.result === 0
                            ? 0
                            : this.emitNotTerminatedNamedEntity();
                    }
                    offset++;
                    this.excess++;
                    const high = (packedWord >> 8) & 0xff;
                    if (runPos + 1 < runLength) {
                        if (input.charCodeAt(offset) !== high) {
                            return this.result === 0
                                ? 0
                                : this.emitNotTerminatedNamedEntity();
                        }
                        offset++;
                        this.excess++;
                    }
                }
                this.treeIndex += 1 + ((remaining + 1) >> 1);
                current = decodeTree[this.treeIndex];
                valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
            }

            if (offset >= input.length) break;

            const char = input.charCodeAt(offset);

            /*
             * Implicit semicolon handling for nodes that require a semicolon but
             * don't have an explicit ';' branch stored in the trie. If we have
             * a value on the current node, it requires a semicolon, and the
             * current input character is a semicolon, emit the entity using the
             * current node (without descending further).
             */
            if (
                char === CharCodes.SEMI &&
                valueLength !== 0 &&
                (current & BinTrieFlags.FLAG13) !== 0
            ) {
                return this.emitNamedEntityData(
                    this.treeIndex,
                    valueLength,
                    this.consumed + this.excess,
                );
            }

            this.treeIndex = determineBranch(
                decodeTree,
                current,
                this.treeIndex + Math.max(1, valueLength),
                char,
            );

            if (this.treeIndex < 0) {
                return this.result === 0 ||
                    // If we are parsing an attribute
                    (this.decodeMode === DecodingMode.Attribute &&
                        // We shouldn't have consumed any characters after the entity,
                        (valueLength === 0 ||
                            // And there should be no invalid characters.
                            isEntityInAttributeInvalidEnd(char)))
                    ? 0
                    : this.emitNotTerminatedNamedEntity();
            }

            current = decodeTree[this.treeIndex];
            valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;

            // If the branch is a value, store it and continue
            if (valueLength !== 0) {
                // If the entity is terminated by a semicolon, we are done.
                if (char === CharCodes.SEMI) {
                    return this.emitNamedEntityData(
                        this.treeIndex,
                        valueLength,
                        this.consumed + this.excess,
                    );
                }

                // If we encounter a non-terminated (legacy) entity while parsing strictly, then ignore it.
                if (
                    this.decodeMode !== DecodingMode.Strict &&
                    (current & BinTrieFlags.FLAG13) === 0
                ) {
                    this.result = this.treeIndex;
                    this.consumed += this.excess;
                    this.excess = 0;
                }
            }
            // Increment offset & excess for next iteration
            offset++;
            this.excess++;
        }

        return -1;
    }

    /**
     * Emit a named entity that was not terminated with a semicolon.
     *
     * @returns The number of characters consumed.
     */
    private emitNotTerminatedNamedEntity(): number {
        const { result, decodeTree } = this;

        const valueLength =
            (decodeTree[result] & BinTrieFlags.VALUE_LENGTH) >> 14;

        this.emitNamedEntityData(result, valueLength, this.consumed);
        this.errors?.missingSemicolonAfterCharacterReference();

        return this.consumed;
    }

    /**
     * Emit a named entity.
     *
     * @param result The index of the entity in the decode tree.
     * @param valueLength The number of bytes in the entity.
     * @param consumed The number of characters consumed.
     *
     * @returns The number of characters consumed.
     */
    private emitNamedEntityData(
        result: number,
        valueLength: number,
        consumed: number,
    ): number {
        const { decodeTree } = this;

        this.emitCodePoint(
            valueLength === 1
                ? decodeTree[result] &
                      ~(BinTrieFlags.VALUE_LENGTH | BinTrieFlags.FLAG13)
                : decodeTree[result + 1],
            consumed,
        );
        if (valueLength === 3) {
            // For multi-byte values, we need to emit the second byte.
            this.emitCodePoint(decodeTree[result + 2], consumed);
        }

        return consumed;
    }

    /**
     * Signal to the parser that the end of the input was reached.
     *
     * Remaining data will be emitted and relevant errors will be produced.
     *
     * @returns The number of characters consumed.
     */
    end(): number {
        switch (this.state) {
            case EntityDecoderState.NamedEntity: {
                // Emit a named entity if we have one.
                return this.result !== 0 &&
                    (this.decodeMode !== DecodingMode.Attribute ||
                        this.result === this.treeIndex)
                    ? this.emitNotTerminatedNamedEntity()
                    : 0;
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
            case EntityDecoderState.EntityStart: {
                // Return 0 if we have no entity.
                return 0;
            }
        }
    }
}

/**
 * Creates a function that decodes entities in a string.
 *
 * @param decodeTree The decode tree.
 * @returns A function that decodes entities in a string.
 */
function getDecoder(decodeTree: Uint16Array) {
    let returnValue = "";
    const decoder = new EntityDecoder(
        decodeTree,
        (data) => (returnValue += fromCodePoint(data)),
    );

    return function decodeWithTrie(
        input: string,
        decodeMode: DecodingMode,
    ): string {
        let lastIndex = 0;
        let offset = 0;

        while ((offset = input.indexOf("&", offset)) >= 0) {
            returnValue += input.slice(lastIndex, offset);

            decoder.startEntity(decodeMode);

            const length = decoder.write(
                input,
                // Skip the "&"
                offset + 1,
            );

            if (length < 0) {
                lastIndex = offset + decoder.end();
                break;
            }

            lastIndex = offset + length;
            // If `length` is 0, skip the current `&` and continue.
            offset = length === 0 ? lastIndex + 1 : lastIndex;
        }

        const result = returnValue + input.slice(lastIndex);

        // Make sure we don't keep a reference to the final string.
        returnValue = "";

        return result;
    };
}

/**
 * Determines the branch of the current node that is taken given the current
 * character. This function is used to traverse the trie.
 *
 * @param decodeTree The trie.
 * @param current The current node.
 * @param nodeIdx The index right after the current node and its value.
 * @param char The current character.
 * @returns The index of the next node, or -1 if no branch is taken.
 */
export function determineBranch(
    decodeTree: Uint16Array,
    current: number,
    nodeIndex: number,
    char: number,
): number {
    const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
    const jumpOffset = current & BinTrieFlags.JUMP_TABLE;

    // Case 1: Single branch encoded in jump offset
    if (branchCount === 0) {
        return jumpOffset !== 0 && char === jumpOffset ? nodeIndex : -1;
    }

    // Case 2: Multiple branches encoded in jump table
    if (jumpOffset) {
        const value = char - jumpOffset;

        return value < 0 || value >= branchCount
            ? -1
            : decodeTree[nodeIndex + value] - 1;
    }

    // Case 3: Multiple branches encoded in packed dictionary (two keys per uint16)
    const packedKeySlots = (branchCount + 1) >> 1;

    /*
     * Treat packed keys as a virtual sorted array of length `branchCount`.
     * Key(i) = low byte for even i, high byte for odd i in slot i>>1.
     */
    let lo = 0;
    let hi = branchCount - 1;

    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const slot = mid >> 1;
        const packed = decodeTree[nodeIndex + slot];
        const midKey = (packed >> ((mid & 1) * 8)) & 0xff;

        if (midKey < char) {
            lo = mid + 1;
        } else if (midKey > char) {
            hi = mid - 1;
        } else {
            return decodeTree[nodeIndex + packedKeySlots + mid];
        }
    }

    return -1;
}

const htmlDecoder = /* #__PURE__ */ getDecoder(htmlDecodeTree);
const xmlDecoder = /* #__PURE__ */ getDecoder(xmlDecodeTree);

/**
 * Decodes an HTML string.
 *
 * @param htmlString The string to decode.
 * @param mode The decoding mode.
 * @returns The decoded string.
 */
export function decodeHTML(
    htmlString: string,
    mode: DecodingMode = DecodingMode.Legacy,
): string {
    return htmlDecoder(htmlString, mode);
}

/**
 * Decodes an HTML string in an attribute.
 *
 * @param htmlAttribute The string to decode.
 * @returns The decoded string.
 */
export function decodeHTMLAttribute(htmlAttribute: string): string {
    return htmlDecoder(htmlAttribute, DecodingMode.Attribute);
}

/**
 * Decodes an HTML string, requiring all entities to be terminated by a semicolon.
 *
 * @param htmlString The string to decode.
 * @returns The decoded string.
 */
export function decodeHTMLStrict(htmlString: string): string {
    return htmlDecoder(htmlString, DecodingMode.Strict);
}

/**
 * Decodes an XML string, requiring all entities to be terminated by a semicolon.
 *
 * @param xmlString The string to decode.
 * @returns The decoded string.
 */
export function decodeXML(xmlString: string): string {
    return xmlDecoder(xmlString, DecodingMode.Strict);
}

export {
    decodeCodePoint,
    fromCodePoint,
    replaceCodePoint,
} from "./decode-codepoint.js";
// Re-export for use by eg. htmlparser2
export { htmlDecodeTree } from "./generated/decode-data-html.js";
export { xmlDecodeTree } from "./generated/decode-data-xml.js";
