import { replaceCodePoint } from "./decode-codepoint.js";
import { htmlDecodeTree } from "./generated/decode-data-html.js";
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
    UPPER_X = 88, // "X"
    UPPER_Z = 90, // "Z"
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

function isAlpha(code: number): boolean {
    return ((code | TO_LOWER_BIT) - CharCodes.LOWER_A) >>> 0 <= 25; // Z - a
}

/**
 * Checks if the given character is a valid end character for an entity in an attribute.
 *
 * Attribute values that aren't terminated properly aren't parsed, and shouldn't lead to a parser error.
 * See the example in https://html.spec.whatwg.org/multipage/parsing.html#named-character-reference-state
 * @param code Code point to decode.
 */
function isEntityInAttributeInvalidEnd(code: number): boolean {
    return code === CharCodes.EQUALS || isAlpha(code) || isNumber(code);
}

const enum EntityDecoderState {
    EntityStart,
    NumericStart,
    NumericDecimal,
    NumericHex,
    NamedEntity,
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
         * @param codepoint The decoded codepoint.
         * @param consumed The number of bytes consumed by the decoder.
         */
        private readonly emitCodePoint: (cp: number, consumed: number) => void,
        /** An object that is used to produce errors. */
        private readonly errors?: EntityErrorProducer | undefined,
    ) {}

    /** The current state of the decoder. */
    private state: number = EntityDecoderState.EntityStart;
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
    /** The number of characters that have been consumed in the current run. */
    private runConsumed = 0;

    /**
     * Resets the instance to make it reusable.
     * @param decodeMode Entity decoding mode to use.
     */
    startEntity(decodeMode: DecodingMode): void {
        this.decodeMode = decodeMode;
        this.state = EntityDecoderState.EntityStart;
        this.result = 0;
        this.treeIndex = 0;
        this.excess = 1;
        this.consumed = 1;
        this.runConsumed = 0;
    }

    /**
     * Write an entity to the decoder. This can be called multiple times with partial entities.
     * If the entity is incomplete, the decoder will return -1.
     *
     * Mirrors the implementation of `getDecoder`, but with the ability to stop decoding if the
     * entity is incomplete, and resume when the next string is written.
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
     * Equivalent to the `Hexademical character reference state` in the HTML spec.
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
                this.consumed += 1;
                offset += 1;
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
     * @param input The string containing the entity (or a continuation of the entity).
     * @param offset The current offset.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    private stateNumericDecimal(input: string, offset: number): number {
        while (offset < input.length) {
            const char = input.charCodeAt(offset);
            if (isNumber(char)) {
                this.result = this.result * 10 + (char - CharCodes.ZERO);
                this.consumed += 1;
                offset += 1;
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
     * @param input The string containing the entity (or a continuation of the entity).
     * @param offset The current offset.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    private stateNamedEntity(input: string, offset: number): number {
        const { decodeTree } = this;
        const inputLength = input.length;
        let current = decodeTree[this.treeIndex];
        // The number of bytes of the value, including the current byte.
        let valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;

        while (offset < inputLength) {
            // Handle compact runs (possibly resumable): valueLength == 0 and FLAG13 set.
            if (valueLength === 0 && (current & BinTrieFlags.FLAG13) !== 0) {
                const runLength =
                    (current & BinTrieFlags.BRANCH_LENGTH) >> 7; /* 2..63 */

                // If we are starting a run, check the first char.
                if (this.runConsumed === 0) {
                    const firstChar = current & BinTrieFlags.JUMP_TABLE;
                    if (input.charCodeAt(offset) !== firstChar) {
                        return this.result === 0
                            ? 0
                            : this.emitNotTerminatedNamedEntity();
                    }
                    offset += 1;
                    this.excess += 1;
                    this.runConsumed += 1;
                }

                // Check remaining characters in the run (packed two per uint16 word).
                while (this.runConsumed < runLength) {
                    if (offset >= inputLength) return -1;

                    const charIndexInPacked = this.runConsumed - 1;
                    const packedWord =
                        decodeTree[
                            this.treeIndex + 1 + (charIndexInPacked >> 1)
                        ];
                    const expectedChar =
                        (charIndexInPacked & 1) === 0
                            ? packedWord & 0xff
                            : (packedWord >> 8) & 0xff;

                    if (input.charCodeAt(offset) !== expectedChar) {
                        this.runConsumed = 0;
                        return this.result === 0
                            ? 0
                            : this.emitNotTerminatedNamedEntity();
                    }
                    offset += 1;
                    this.excess += 1;
                    this.runConsumed += 1;
                }

                this.runConsumed = 0;
                this.treeIndex += 1 + (runLength >> 1);
                current = decodeTree[this.treeIndex];
                valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;

                // Record legacy match at end of compact run (FLAG13 clear = semicolon optional).
                if (
                    valueLength !== 0 &&
                    this.decodeMode !== DecodingMode.Strict &&
                    (current & BinTrieFlags.FLAG13) === 0
                ) {
                    this.result = this.treeIndex;
                    this.consumed += this.excess;
                    this.excess = 0;
                }
            }

            if (offset >= inputLength) break;

            const char = input.charCodeAt(offset);

            /*
             * Implicit semicolon handling: if the current node has a value and the
             * input character is `;`, emit immediately. This covers both strict
             * entities (FLAG13 set) and legacy entities (FLAG13 clear) — neither
             * stores an explicit `;` branch in the trie.
             */
            if (char === CharCodes.SEMI && valueLength !== 0) {
                return this.emitNamedEntityData(
                    this.treeIndex,
                    valueLength,
                    this.consumed + this.excess,
                );
            }

            // Navigate to the next node (valueLength || 1: skip past value words, minimum 1 for header).
            this.treeIndex = determineBranch(
                decodeTree,
                current,
                this.treeIndex + (valueLength || 1),
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

            /*
             * Record non-terminated (legacy) match for later emission.
             * (`;` is always caught by the pre-navigation check above.)
             */
            if (
                valueLength !== 0 &&
                this.decodeMode !== DecodingMode.Strict &&
                (current & BinTrieFlags.FLAG13) === 0
            ) {
                this.result = this.treeIndex;
                this.consumed += this.excess;
                this.excess = 0;
            }
            // Increment offset & excess for next iteration.
            offset += 1;
            this.excess += 1;
        }

        return -1;
    }

    /**
     * Emit a named entity that was not terminated with a semicolon.
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
     * @param result The index of the entity in the decode tree.
     * @param valueLength The number of bytes in the entity.
     * @param consumed The number of characters consumed.
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
            default: {
                // EntityStart or unknown — return 0.
                return 0;
            }
        }
    }
}

/**
 * Determines the branch of the current node that is taken given the current
 * character. This function is used to traverse the trie.
 * @param decodeTree The trie.
 * @param current The current node.
 * @param nodeIndex Index immediately after the current node header.
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

    // Case 1: Single branch or jump table (jumpOffset encodes the first/only char code).
    if (jumpOffset) {
        if (branchCount === 0) {
            // Single branch encoded inline in the jump offset bits.
            return char === jumpOffset ? nodeIndex : -1;
        }

        /*
         * Jump table: branchCount consecutive slots starting at jumpOffset.
         * Unsigned comparison handles both < 0 and >= branchCount in one check.
         */
        const value = char - jumpOffset;
        if (value >>> 0 >= branchCount) return -1;
        const stored = decodeTree[nodeIndex + value];
        // 0 = empty slot (no branch); otherwise relative offset + 1.
        return stored === 0 ? -1 : (nodeIndex + value + stored - 1) & 0xff_ff;
    }

    // Case 2: Packed dictionary (binary search on sorted keys).
    if (branchCount === 0) return -1;
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
        const midKey = (packed >> ((mid & 1) << 3)) & 0xff;

        if (midKey < char) {
            lo = mid + 1;
        } else if (midKey > char) {
            hi = mid - 1;
        } else {
            const pointerIndex = nodeIndex + packedKeySlots + mid;
            return (pointerIndex + decodeTree[pointerIndex]) & 0xff_ff;
        }
    }

    return -1;
}

/**
 * Read the decoded value from a trie node.
 * @param decodeTree The trie.
 * @param nodeIndex The index of the node.
 * @param valueLength The length of the value (1, 2, or 3).
 * @returns The decoded string.
 */
function readTrieValue(
    decodeTree: Uint16Array,
    nodeIndex: number,
    valueLength: number,
): string {
    if (valueLength === 1) {
        return String.fromCharCode(
            decodeTree[nodeIndex] &
                ~(BinTrieFlags.VALUE_LENGTH | BinTrieFlags.FLAG13),
        );
    }
    if (valueLength === 2) {
        return String.fromCharCode(decodeTree[nodeIndex + 1]);
    }
    return String.fromCharCode(
        decodeTree[nodeIndex + 1],
        decodeTree[nodeIndex + 2],
    );
}

/** Shared constant for the no-match return from decodeTrieNumeric. */
const NO_MATCH: [consumed: number, value: string] = [0, ""];

/**
 * Decode a numeric entity (&#DDD; or &#xHHH;).
 * @param input The input string containing the entity, starting with the "#" character.
 * @param numberStart The index of the "#" character in the input string.
 * @param strict
 * @returns [consumed, value] tuple, or NO_MATCH for no match.
 */
function decodeTrieNumeric(
    input: string,
    numberStart: number,
    strict: boolean,
): [number, string] {
    let offset = numberStart + 1; // Skip "#"
    let base = 10;
    const inputLength = input.length;

    if (offset < inputLength) {
        const first = input.charCodeAt(offset);
        if (first === CharCodes.LOWER_X || first === CharCodes.UPPER_X) {
            base = 16;
            offset += 1;
        }
    }

    let cp = 0;
    let digits = 0;
    while (offset < inputLength) {
        const char = input.charCodeAt(offset);

        if (char === CharCodes.SEMI) {
            if (digits === 0) return NO_MATCH;
            return [
                offset - numberStart + 1,
                String.fromCodePoint(replaceCodePoint(cp)),
            ];
        }

        if (isNumber(char)) {
            cp = cp * base + (char - CharCodes.ZERO);
        } else if (base === 16 && isHexadecimalCharacter(char)) {
            cp = cp * 16 + ((char | TO_LOWER_BIT) - CharCodes.LOWER_A + 10);
        } else {
            /*
             * Non-digit, non-semicolon: in legacy/attribute mode accept
             * the digits consumed so far (matching EntityDecoder behavior).
             */
            if (!strict && digits > 0) {
                return [
                    offset - numberStart,
                    String.fromCodePoint(replaceCodePoint(cp)),
                ];
            }
            return NO_MATCH;
        }

        digits += 1;
        offset += 1;
    }

    // End of input: in legacy/attribute mode accept if we have digits.
    if (!strict && digits > 0) {
        return [
            offset - numberStart,
            String.fromCodePoint(replaceCodePoint(cp)),
        ];
    }
    return NO_MATCH;
}

/**
 * Decode all entities in `input` using the given trie.
 * @param input      The string to decode.
 * @param decodeTree The binary trie (XML or HTML).
 * @param strict Only match semicolon-terminated entities.
 * @param attribute Whether to apply attribute-specific parsing rules (disallowing certain non-semicolon terminators).
 * @returns The decoded string.
 */
function decodeWithTrie(
    input: string,
    decodeTree: Uint16Array,
    strict: boolean,
    attribute: boolean,
): string {
    // Fast path: no entities at all — return input without any allocation.
    let offset = input.indexOf("&");
    if (offset < 0) return input;

    const inputLength = input.length;
    let lastIndex = 0;
    let result = "";

    do {
        if (lastIndex < offset) result += input.slice(lastIndex, offset);

        const entityStart = offset + 1;

        // Quick check: entity names must start with [A-Za-z], numeric with #.
        const firstChar = input.charCodeAt(entityStart);
        let consumed: number;
        let value: string;
        if (firstChar === CharCodes.NUM) {
            [consumed, value] = decodeTrieNumeric(input, entityStart, strict);
        } else if (isAlpha(firstChar)) {
            consumed = 0;
            value = "";

            let nodeIndex = 0;
            let current = decodeTree[nodeIndex];

            /*
             * Best legacy match found so far. We store the node
             * coordinates and defer readTrieValue() to the end,
             * avoiding repeated String.fromCharCode allocations.
             */
            let bestNodeIndex = 0;
            let bestValueLength = 0;

            let index = entityStart;

            // Label for breaking out of the main loop from inside the compact run inner loop.
            trie: while (index < inputLength) {
                // The number of bytes of the value, including the current byte.
                const valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;

                // Handle compact runs — inline to avoid 5-argument function call overhead.
                if (
                    valueLength === 0 &&
                    (current & BinTrieFlags.FLAG13) !== 0
                ) {
                    const runLength =
                        (current & BinTrieFlags.BRANCH_LENGTH) >> 7;

                    // Check first char (stored in JUMP_TABLE bits).
                    if (
                        input.charCodeAt(index) !==
                        (current & BinTrieFlags.JUMP_TABLE)
                    ) {
                        break;
                    }
                    index += 1;

                    // Check remaining characters (packed two per uint16 word).
                    const remaining = runLength - 1;
                    let wordIndex = nodeIndex + 1;
                    let charIndexInPacked = 0;

                    /*
                     * Process pairs: read one packed word, compare low byte then high byte.
                     * No explicit bounds check needed — charCodeAt returns NaN for OOB,
                     * which never equals an integer, so the mismatch break fires naturally.
                     */
                    for (
                        ;
                        charIndexInPacked + 1 < remaining;
                        charIndexInPacked += 2
                    ) {
                        const packed = decodeTree[wordIndex];
                        if (input.charCodeAt(index) !== (packed & 0xff))
                            break trie;
                        index += 1;
                        if (input.charCodeAt(index) !== ((packed >> 8) & 0xff))
                            break trie;
                        index += 1;
                        wordIndex += 1;
                    }
                    // Handle odd trailing char.
                    if (charIndexInPacked < remaining) {
                        if (
                            input.charCodeAt(index) !==
                            (decodeTree[wordIndex] & 0xff)
                        )
                            break;
                        index += 1;
                    }

                    nodeIndex += 1 + (runLength >> 1);
                    current = decodeTree[nodeIndex];
                    continue;
                }

                const char = input.charCodeAt(index);

                /*
                 * Check current node for a value before navigating.
                 * This handles both: (a) values reached via compact runs on the
                 * previous iteration, and (b) values at regular branch targets.
                 */
                if (valueLength !== 0) {
                    // If char is `;`, emit immediately.
                    if (char === CharCodes.SEMI) {
                        consumed = index - entityStart + 1;
                        value = readTrieValue(
                            decodeTree,
                            nodeIndex,
                            valueLength,
                        );
                        break;
                    }

                    // Record non-terminated (legacy) match (FLAG13 clear = semicolon optional).
                    if (!strict && (current & BinTrieFlags.FLAG13) === 0) {
                        consumed = index - entityStart;
                        bestNodeIndex = nodeIndex;
                        bestValueLength = valueLength;
                    }

                    /*
                     * A valueLength of 1 means the value is packed inline in the header
                     * word — these are always leaf nodes with no branches, so we can
                     * stop walking the trie.
                     */
                    if (valueLength === 1) break;
                }

                // Navigate to the next node (valueLength || 1: skip past value words, minimum 1 for header).
                const next = determineBranch(
                    decodeTree,
                    current,
                    nodeIndex + (valueLength || 1),
                    char,
                );
                if (next < 0) break;

                nodeIndex = next;
                current = decodeTree[nodeIndex];
                index += 1;
            }

            /*
             * Post-loop: if the semicolon path didn't set value,
             * check for a final legacy match. The last navigation may
             * have landed on a legacy node whose value hasn't been
             * recorded yet (loop exited before the top-of-loop check
             * could run).
             */
            if (value === "") {
                const finalVL = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
                if (
                    finalVL !== 0 &&
                    !strict &&
                    (current & BinTrieFlags.FLAG13) === 0
                ) {
                    consumed = index - entityStart;
                    bestNodeIndex = nodeIndex;
                    bestValueLength = finalVL;
                }
                if (consumed > 0) {
                    value = readTrieValue(
                        decodeTree,
                        bestNodeIndex,
                        bestValueLength,
                    );
                }
            }
        } else {
            consumed = 0;
            value = "";
        }

        if (
            consumed === 0 ||
            (attribute &&
                entityStart + consumed < inputLength &&
                isEntityInAttributeInvalidEnd(
                    input.charCodeAt(entityStart + consumed),
                ))
        ) {
            result += "&";
            lastIndex = entityStart;
        } else {
            result += value;
            lastIndex = entityStart + consumed;
        }
        offset = lastIndex;
    } while ((offset = input.indexOf("&", offset)) >= 0);

    return result + input.slice(lastIndex);
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
    return decodeWithTrie(
        htmlString,
        htmlDecodeTree,
        mode === DecodingMode.Strict,
        mode === DecodingMode.Attribute,
    );
}

/**
 * Decodes an HTML string in an attribute.
 * @param htmlAttribute The string to decode.
 * @returns The decoded string.
 */
export function decodeHTMLAttribute(htmlAttribute: string): string {
    return decodeWithTrie(htmlAttribute, htmlDecodeTree, false, true);
}

/**
 * Decodes an HTML string, requiring all entities to be terminated by a semicolon.
 * @param htmlString The string to decode.
 * @returns The decoded string.
 */
export function decodeHTMLStrict(htmlString: string): string {
    return decodeWithTrie(htmlString, htmlDecodeTree, true, false);
}

/**
 * Decodes an XML string, requiring all entities to be terminated by a semicolon.
 *
 * Uses a hand-coded fast path for the 5 XML named entities (amp, lt, gt,
 * quot, apos) plus numeric entities, bypassing the trie entirely.
 * @param xmlString The string to decode.
 * @returns The decoded string.
 */
export function decodeXML(xmlString: string): string {
    let offset = xmlString.indexOf("&");
    if (offset < 0) return xmlString;

    let lastIndex = 0;
    let result = "";

    do {
        if (lastIndex < offset) result += xmlString.slice(lastIndex, offset);
        const start = offset + 1;
        let consumed = 0;
        let value = "";

        const c1 = xmlString.charCodeAt(start);

        if (c1 === CharCodes.NUM) {
            [consumed, value] = decodeTrieNumeric(xmlString, start, true);
        } else {
            const c2 = xmlString.charCodeAt(start + 1);
            const c3 = xmlString.charCodeAt(start + 2);

            // &lt;
            if (c1 === 0x6c && c2 === 0x74 && c3 === CharCodes.SEMI) {
                consumed = 3;
                value = "<";
                // &gt;
            } else if (c1 === 0x67 && c2 === 0x74 && c3 === CharCodes.SEMI) {
                consumed = 3;
                value = ">";
                // &amp;
            } else if (
                c1 === 0x61 &&
                c2 === 0x6d &&
                c3 === 0x70 &&
                xmlString.charCodeAt(start + 3) === CharCodes.SEMI
            ) {
                consumed = 4;
                value = "&";
                // &quot; / &apos; — both have 'o' at position 3
            } else if (c3 === 0x6f) {
                // &quot;
                if (
                    c1 === 0x71 &&
                    c2 === 0x75 &&
                    xmlString.charCodeAt(start + 3) === 0x74 &&
                    xmlString.charCodeAt(start + 4) === CharCodes.SEMI
                ) {
                    consumed = 5;
                    value = '"';
                    // &apos;
                } else if (
                    c1 === 0x61 &&
                    c2 === 0x70 &&
                    xmlString.charCodeAt(start + 3) === 0x73 &&
                    xmlString.charCodeAt(start + 4) === CharCodes.SEMI
                ) {
                    consumed = 5;
                    value = "'";
                }
            }
        }

        if (consumed > 0) {
            result += value;
            lastIndex = start + consumed;
        } else {
            result += "&";
            lastIndex = start;
        }
        offset = lastIndex;
    } while ((offset = xmlString.indexOf("&", offset)) >= 0);

    return result + xmlString.slice(lastIndex);
}

export { replaceCodePoint } from "./decode-codepoint.js";
// Re-export for use by eg. htmlparser2
export { htmlDecodeTree } from "./generated/decode-data-html.js";
export { xmlDecodeTree } from "./generated/decode-data-xml.js";
