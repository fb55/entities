import htmlDecodeTree from "./generated/decode-data-html.js";
import xmlDecodeTree from "./generated/decode-data-xml.js";
import decodeCodePoint, {
    replaceCodePoint,
    fromCodePoint,
} from "./decode_codepoint.js";

// Re-export for use by eg. htmlparser2
export { htmlDecodeTree, xmlDecodeTree, decodeCodePoint };
export { replaceCodePoint, fromCodePoint } from "./decode_codepoint.js";

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
    /** Bit that needs to be set to convert an upper case ASCII character to lower case */
    TO_LOWER_BIT = 0b100000,
}

export enum BinTrieFlags {
    VALUE_LENGTH = 0b1100_0000_0000_0000,
    BRANCH_LENGTH = 0b0011_1111_1000_0000,
    JUMP_TABLE = 0b0000_0000_0111_1111,
}

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

export enum EntityDecoderMode {
    /** Only allow entities terminated with a semicolon. */
    Strict,
    /** Entities in attributes have limitations on ending characters. */
    Attribute,
    /** Entities in text nodes can end with any character. */
    Text,
}

/**
 * Implementation of `getDecoder`, but with support of writing partial entities.
 *
 * This is used by the `Tokenizer` to decode entities in chunks.
 */
export class EntityDecoder {
    constructor(
        private readonly decodeTree: Uint16Array,
        private readonly emitCodePoint: (cp: number, consumed: number) => void
    ) {}

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

    private treeIdx = 0;
    private excess = 1;
    private decodeMode = EntityDecoderMode.Strict;

    /** Resets the instance to make it reusable. */
    startEntity(decodeMode: EntityDecoderMode): void {
        this.decodeMode = decodeMode;
        this.state = EntityDecoderState.EntityStart;
        this.result = 0;
        this.treeIdx = 0;
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
     * @param string The string containing the entity (or a continuation of the entity).
     * @param offset The offset at which the entity begins. Should be 0 if this is not the first call.
     * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
     */
    write(str: string, offset: number): number {
        switch (this.state) {
            case EntityDecoderState.EntityStart: {
                if (str.charCodeAt(offset) === CharCodes.NUM) {
                    this.state = EntityDecoderState.NumericStart;
                    this.consumed += 1;
                    return this.stateNumericStart(str, offset + 1);
                }
                this.state = EntityDecoderState.NamedEntity;
                return this.stateNamedEntity(str, offset);
            }

            case EntityDecoderState.NumericStart: {
                return this.stateNumericStart(str, offset);
            }

            case EntityDecoderState.NumericDecimal: {
                return this.stateNumericDecimal(str, offset);
            }

            case EntityDecoderState.NumericHex: {
                return this.stateNumericHex(str, offset);
            }

            case EntityDecoderState.NamedEntity: {
                return this.stateNamedEntity(str, offset);
            }
        }
    }

    private stateNumericStart(str: string, strIdx: number): number {
        if (strIdx >= str.length) {
            return -1;
        }

        const char = str.charCodeAt(strIdx);
        if ((char | CharCodes.TO_LOWER_BIT) === CharCodes.LOWER_X) {
            this.state = EntityDecoderState.NumericHex;
            this.consumed += 1;
            return this.stateNumericHex(str, strIdx + 1);
        }

        this.state = EntityDecoderState.NumericDecimal;
        return this.stateNumericDecimal(str, strIdx);
    }

    private addToNumericResult(
        str: string,
        start: number,
        end: number,
        base: number
    ): void {
        if (start !== end) {
            this.result =
                this.result * base + parseInt(str.slice(start, end), base);
            this.consumed += end - start;
        }
    }

    private stateNumericHex(str: string, strIdx: number): number {
        const startIdx = strIdx;

        while (strIdx < str.length) {
            const char = str.charCodeAt(strIdx);
            if (isNumber(char) || isHexadecimalCharacter(char)) {
                strIdx += 1;
            } else {
                this.addToNumericResult(str, startIdx, strIdx, 16);

                return this.consumed > 3 ? this.emitNumericEntity(char) : 0;
            }
        }

        this.addToNumericResult(str, startIdx, strIdx, 16);

        return -1;
    }

    private stateNumericDecimal(str: string, strIdx: number): number {
        const startIdx = strIdx;

        while (strIdx < str.length) {
            const char = str.charCodeAt(strIdx);
            if (isNumber(char)) {
                strIdx += 1;
            } else {
                this.addToNumericResult(str, startIdx, strIdx, 10);

                return this.consumed > 2 ? this.emitNumericEntity(char) : 0;
            }
        }

        this.addToNumericResult(str, startIdx, strIdx, 10);

        return -1;
    }

    private emitNumericEntity(lastCp: number): number {
        // TODO Figure out if this is a legit end of the entity
        if (lastCp === CharCodes.SEMI) {
            this.consumed += 1;
        } else if (this.decodeMode === EntityDecoderMode.Strict) {
            return 0;
        }

        // TODO Produce errors

        this.emitCodePoint(replaceCodePoint(this.result), this.consumed);
        return this.consumed;
    }

    private stateNamedEntity(str: string, strIdx: number): number {
        const { decodeTree } = this;
        let current = decodeTree[this.treeIdx];
        // The mask is the number of bytes of the value, including the current byte.
        let valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;

        for (; strIdx < str.length; strIdx++, this.excess++) {
            const char = str.charCodeAt(strIdx);

            this.treeIdx = determineBranch(
                decodeTree,
                current,
                this.treeIdx + Math.max(1, valueLength),
                char
            );

            if (this.treeIdx < 0) {
                return this.decodeMode === EntityDecoderMode.Attribute &&
                    isEntityInAttributeInvalidEnd(char)
                    ? 0
                    : this.emitNamedEntity();
            }

            current = decodeTree[this.treeIdx];
            valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;

            // If the branch is a value, store it and continue
            if (valueLength !== 0) {
                // If we encounter a legacy entity while parsing strictly, then ignore it.
                if (
                    char === CharCodes.SEMI ||
                    this.decodeMode !== EntityDecoderMode.Strict
                ) {
                    this.result = this.treeIdx;
                    this.consumed += this.excess;
                    this.excess = 0;
                }

                // If the entity is terminated by a semicolon, we are done.
                if (char === CharCodes.SEMI) {
                    return this.emitNamedEntity();
                }
            }
        }

        return -1;
    }

    private emitNamedEntity(): number {
        const { result, decodeTree } = this;

        if (result !== 0) {
            const valueLength =
                (decodeTree[result] & BinTrieFlags.VALUE_LENGTH) >> 14;

            this.emitCodePoint(
                valueLength === 1
                    ? decodeTree[result] & ~BinTrieFlags.VALUE_LENGTH
                    : decodeTree[result + 1],
                this.consumed
            );
            if (valueLength === 3) {
                // For multi-byte values, we need to emit the second byte.
                this.emitCodePoint(decodeTree[result + 2], this.consumed);
            }

            return this.consumed;
        }

        return 0;
    }

    end(): number {
        switch (this.state) {
            case EntityDecoderState.NamedEntity: {
                // Emit a named entity if we have one.
                return this.emitNamedEntity();
            }
            // Otherwise, emit a numeric entity if we have one.
            case EntityDecoderState.NumericDecimal: {
                // Ensure we consumed at least one numeric character.
                if (this.consumed > 2) {
                    return this.emitNumericEntity(0);
                }
                return 0;
            }
            case EntityDecoderState.NumericHex: {
                if (this.consumed > 3) {
                    return this.emitNumericEntity(0);
                }
                return 0;
            }
            default: {
                // Return 0 if we have no entity.
                return 0;
            }
        }
    }
}

function getDecoder(decodeTree: Uint16Array) {
    let ret = "";
    const decoder = new EntityDecoder(
        decodeTree,
        (str) => (ret += fromCodePoint(str))
    );

    return function decodeWithTrie(str: string, strict: boolean): string {
        const decodeMode = strict
            ? EntityDecoderMode.Strict
            : EntityDecoderMode.Text;

        let lastIdx = 0;
        let strIdx = 0;

        while ((strIdx = str.indexOf("&", strIdx)) >= 0) {
            ret += str.slice(lastIdx, strIdx);

            decoder.startEntity(decodeMode);

            const len = decoder.write(
                str,
                // Skip the "&"
                strIdx + 1
            );

            if (len < 0) {
                lastIdx = strIdx + decoder.end();
                break;
            }

            lastIdx = strIdx + len;
            // If `len` is 0, skip the current `&` and continue.
            strIdx = len === 0 ? lastIdx + 1 : lastIdx;
        }

        const result = ret + str.slice(lastIdx);

        // Make sure we don't keep a reference to the final string.
        ret = "";

        return result;
    };
}

export function determineBranch(
    decodeTree: Uint16Array,
    current: number,
    nodeIdx: number,
    char: number
): number {
    const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
    const jumpOffset = current & BinTrieFlags.JUMP_TABLE;

    // Case 1: Single branch encoded in jump offset
    if (branchCount === 0) {
        return jumpOffset !== 0 && char === jumpOffset ? nodeIdx : -1;
    }

    // Case 2: Multiple branches encoded in jump table
    if (jumpOffset) {
        const value = char - jumpOffset;

        return value < 0 || value >= branchCount
            ? -1
            : decodeTree[nodeIdx + value] - 1;
    }

    // Case 3: Multiple branches encoded in dictionary

    // Binary search for the character.
    let lo = nodeIdx;
    let hi = lo + branchCount - 1;

    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const midVal = decodeTree[mid];

        if (midVal < char) {
            lo = mid + 1;
        } else if (midVal > char) {
            hi = mid - 1;
        } else {
            return decodeTree[mid + branchCount];
        }
    }

    return -1;
}

const htmlDecoder = getDecoder(htmlDecodeTree);
const xmlDecoder = getDecoder(xmlDecodeTree);

/**
 * Decodes an HTML string, allowing for entities not terminated by a semi-colon.
 *
 * @param str The string to decode.
 * @returns The decoded string.
 */
export function decodeHTML(str: string): string {
    return htmlDecoder(str, false);
}

/**
 * Decodes an HTML string, requiring all entities to be terminated by a semi-colon.
 *
 * @param str The string to decode.
 * @returns The decoded string.
 */
export function decodeHTMLStrict(str: string): string {
    return htmlDecoder(str, true);
}

/**
 * Decodes an XML string, requiring all entities to be terminated by a semi-colon.
 *
 * @param str The string to decode.
 * @returns The decoded string.
 */
export function decodeXML(str: string): string {
    return xmlDecoder(str, true);
}
