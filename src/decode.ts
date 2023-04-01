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
    ZERO = 48, // "0"
    NINE = 57, // "9"
    LOWER_A = 97, // "a"
    LOWER_F = 102, // "f"
    LOWER_X = 120, // "x"
    UPPER_A = 65, // "A"
    UPPER_F = 70, // "F"
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
        private readonly emitCodePoint: (cp: number) => void
    ) {}

    private state = EntityDecoderState.EntityStart;
    private consumed = 1;
    private codepoint = 0;

    private treeIdx = 0;
    private resultIdx = 0;
    private excess = 1;
    private decodeMode = EntityDecoderMode.Strict;

    /** Resets the instance to make it reusable. */
    startEntity(decodeMode: EntityDecoderMode): void {
        this.decodeMode = decodeMode;
        this.state = EntityDecoderState.EntityStart;
        this.codepoint = 0;
        this.treeIdx = 0;
        this.excess = 1;
        this.resultIdx = 0;
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
        const char = str.charCodeAt(strIdx);
        if ((char | CharCodes.TO_LOWER_BIT) === CharCodes.LOWER_X) {
            this.state = EntityDecoderState.NumericHex;
            this.consumed += 1;
            return this.stateNumericHex(str, strIdx + 1);
        }

        this.state = EntityDecoderState.NumericDecimal;
        return this.stateNumericDecimal(str, strIdx);
    }

    private stateNumericHex(str: string, strIdx: number): number {
        const startIdx = strIdx;

        while (
            strIdx < str.length &&
            (isNumber(str.charCodeAt(strIdx)) ||
                isHexadecimalCharacter(str.charCodeAt(strIdx)))
        ) {
            strIdx += 1;
        }

        if (startIdx !== strIdx) {
            this.codepoint =
                this.codepoint * 16 + parseInt(str.slice(startIdx, strIdx), 16);
            this.consumed += strIdx - startIdx;

            if (strIdx < str.length) {
                return this.emitNumericEntity(str.charCodeAt(strIdx));
            }
        }

        return -1;
    }

    private stateNumericDecimal(str: string, strIdx: number): number {
        const startIdx = strIdx;

        while (strIdx < str.length && isNumber(str.charCodeAt(strIdx))) {
            strIdx += 1;
        }

        if (startIdx !== strIdx) {
            this.codepoint =
                this.codepoint * 10 + parseInt(str.slice(startIdx, strIdx), 10);
            this.consumed += strIdx - startIdx;

            if (strIdx < str.length) {
                return this.emitNumericEntity(str.charCodeAt(strIdx));
            }
        }

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

        this.emitCodePoint(replaceCodePoint(this.codepoint));
        return this.consumed;
    }

    private stateNamedEntity(str: string, strIdx: number): number {
        const strict = this.decodeMode === EntityDecoderMode.Strict;
        const { decodeTree } = this;
        let current = decodeTree[this.treeIdx];

        for (; strIdx < str.length; strIdx++, this.excess++) {
            this.treeIdx = determineBranch(
                decodeTree,
                current,
                this.treeIdx + 1,
                str.charCodeAt(strIdx)
            );

            if (this.treeIdx < 0) return this.emitNamedEntity();

            current = decodeTree[this.treeIdx];

            const masked = current & BinTrieFlags.VALUE_LENGTH;

            // If the branch is a value, store it and continue
            if (masked) {
                // If we encounter a legacy entity while parsing strictly, just skip the number of bytes
                if (!strict || str.charCodeAt(strIdx) === CharCodes.SEMI) {
                    this.resultIdx = this.treeIdx;
                    this.consumed += this.excess;
                    this.excess = 0;
                }

                // The mask is the number of bytes of the value, including the current byte.
                const valueLength = (masked >> 14) - 1;

                // If the value is stored in the current byte, we are done.
                if (valueLength === 0) return this.emitNamedEntity();

                this.treeIdx += valueLength;
            }
        }

        return -1;
    }

    private emitNamedEntity(): number {
        const { resultIdx, decodeTree } = this;

        if (resultIdx !== 0) {
            const valueLength =
                (this.decodeTree[resultIdx] & BinTrieFlags.VALUE_LENGTH) >> 14;

            this.emitCodePoint(
                valueLength === 1
                    ? decodeTree[resultIdx] & ~BinTrieFlags.VALUE_LENGTH
                    : decodeTree[resultIdx + 1]
            );
            if (valueLength === 3) {
                this.emitCodePoint(decodeTree[resultIdx + 2]);
            }

            return this.consumed;
        }

        return 0;
    }

    end(): number {
        // Emit a named entity if we have one.
        if (this.resultIdx !== 0) {
            return this.emitNamedEntity();
        }

        // Otherwise, emit a numeric entity if we have one.
        if (
            this.codepoint !== 0 ||
            // Make it possible to emit eg. &#000; here.
            (this.consumed > 2 &&
                (this.state === EntityDecoderState.NumericDecimal ||
                    this.consumed > 3))
        ) {
            return this.emitNumericEntity(0);
        }

        // Return 0 if we have no entity.
        return 0;
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
