import htmlDecodeTree from "./generated/decode-data-html";
import xmlDecodeTree from "./generated/decode-data-xml";
import decodeCodePoint from "./decode_codepoint";

// Re-export for use by eg. htmlparser2
export { htmlDecodeTree, xmlDecodeTree };

const enum CharCodes {
    NUM = 35, // "#"
    SEMI = 59, // ";"
    ZERO = 48, // "0"
    NINE = 57, // "9"
    LOWER_A = 97, // "a"
    LOWER_F = 102, // "f"
    LOWER_X = 120, // "x"
    /** Bit that needs to be set to convert an upper case ASCII character to lower case */
    To_LOWER_BIT = 0b100000,
}

export enum BinTrieFlags {
    HAS_VALUE = 0b1000_0000_0000_0000,
    BRANCH_LENGTH = 0b0111_1111_0000_0000,
    MULTI_BYTE = 0b0000_0000_1000_0000,
    JUMP_TABLE = 0b0000_0000_0111_1111,
}

export const JUMP_OFFSET_BASE = CharCodes.ZERO - 1;

function getDecoder(decodeTree: Uint16Array) {
    return function decodeHTMLBinary(str: string, strict: boolean): string {
        let ret = "";
        let lastIdx = 0;
        let strIdx = 0;

        while ((strIdx = str.indexOf("&", strIdx)) >= 0) {
            ret += str.slice(lastIdx, strIdx);
            lastIdx = strIdx;
            // Skip the "&"
            strIdx += 1;

            // If we have a numeric entity, handle this separately.
            if (str.charCodeAt(strIdx) === CharCodes.NUM) {
                // Skip the leading "&#". For hex entities, also skip the leading "x".
                let start = strIdx + 1;
                let base = 10;

                let cp = str.charCodeAt(start);
                if ((cp | CharCodes.To_LOWER_BIT) === CharCodes.LOWER_X) {
                    base = 16;
                    strIdx += 1;
                    start += 1;
                }

                while (
                    ((cp = str.charCodeAt(++strIdx)) >= CharCodes.ZERO &&
                        cp <= CharCodes.NINE) ||
                    (base === 16 &&
                        (cp | CharCodes.To_LOWER_BIT) >= CharCodes.LOWER_A &&
                        (cp | CharCodes.To_LOWER_BIT) <= CharCodes.LOWER_F)
                );

                if (start !== strIdx) {
                    const entity = str.substring(start, strIdx);
                    const parsed = parseInt(entity, base);

                    if (str.charCodeAt(strIdx) === CharCodes.SEMI) {
                        strIdx += 1;
                    } else if (strict) {
                        continue;
                    }

                    ret += decodeCodePoint(parsed);
                    lastIdx = strIdx;
                }

                continue;
            }

            let result: string | null = null;
            let excess = 1;
            let treeIdx = 0;
            let current = decodeTree[treeIdx];

            for (; strIdx < str.length; strIdx++, excess++) {
                treeIdx = determineBranch(
                    decodeTree,
                    current,
                    treeIdx + 1,
                    str.charCodeAt(strIdx)
                );

                if (treeIdx < 0) break;

                current = decodeTree[treeIdx];

                // If the branch is a value, store it and continue
                if (current & BinTrieFlags.HAS_VALUE) {
                    // If we have a legacy entity while parsing strictly, just skip the number of bytes
                    if (strict && str.charCodeAt(strIdx) !== CharCodes.SEMI) {
                        // No need to consider multi-byte values, as the legacy entity is always a single byte
                        treeIdx += 1;
                    } else {
                        // If this is a surrogate pair, combine the higher bits from the node with the next byte
                        result =
                            current & BinTrieFlags.MULTI_BYTE
                                ? String.fromCharCode(
                                      decodeTree[++treeIdx],
                                      decodeTree[++treeIdx]
                                  )
                                : String.fromCharCode(decodeTree[++treeIdx]);
                        excess = 0;
                    }
                }
            }

            if (result != null) {
                ret += result;
                lastIdx = strIdx - excess + 1;
            }
        }

        return ret + str.slice(lastIdx);
    };
}

export function determineBranch(
    decodeTree: Uint16Array,
    current: number,
    nodeIdx: number,
    char: number
): number {
    if (current <= 128) {
        return char === current ? nodeIdx : -1;
    }

    const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 8;

    if (branchCount === 0) {
        return -1;
    }

    if (branchCount === 1) {
        return char === decodeTree[nodeIdx] ? nodeIdx + 1 : -1;
    }

    const jumpOffset = current & BinTrieFlags.JUMP_TABLE;
    if (jumpOffset) {
        const value = char - JUMP_OFFSET_BASE - jumpOffset;

        return value < 0 || value > branchCount
            ? -1
            : decodeTree[nodeIdx + value] - 1;
    }

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

export function decodeHTML(str: string): string {
    return htmlDecoder(str, false);
}

export function decodeHTMLStrict(str: string): string {
    return htmlDecoder(str, true);
}

export function decodeXML(str: string): string {
    return xmlDecoder(str, true);
}
