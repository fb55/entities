import { encodeHTMLTrieRe, getCodePoint } from "./encode-trie";

const htmlReplacer = /[\t\n!-,./:-@[-`\f{-}$\x80-\uFFFF]/g;
const xmlReplacer = /["&'<>$\x80-\uFFFF]/g;
const xmlInvalidChars = /[&<>'"]/g;

const xmlCodeMap = new Map([
    [34, "&quot;"],
    [38, "&amp;"],
    [39, "&apos;"],
    [60, "&lt;"],
    [62, "&gt;"],
]);

/**
 * Encodes all non-ASCII characters, as well as characters not valid in XML
 * documents using XML entities.
 *
 * If a character has no equivalent entity, a
 * numeric hexadecimal reference (eg. `&#xfc;`) will be used.
 */
export function encodeXML(str: string): string {
    let ret = "";
    let lastIdx = 0;
    let match;

    while ((match = xmlReplacer.exec(str)) !== null) {
        const i = match.index;
        const char = str.charCodeAt(i);
        const next = xmlCodeMap.get(char);

        if (next) {
            ret += str.substring(lastIdx, i) + next;
            lastIdx = i + 1;
        } else {
            ret += `${str.substring(lastIdx, i)}&#x${getCodePoint(
                str,
                i
            ).toString(16)};`;
            // Increase by 1 if we have a surrogate pair
            lastIdx = xmlReplacer.lastIndex += Number(
                (char & 0b1111_1111_1000_0000) === 0xd800
            );
        }
    }

    return ret + str.substr(lastIdx);
}

/**
 * Encodes all entities and non-ASCII characters in the input.
 *
 * This includes characters that are valid ASCII characters in HTML documents.
 * For example `#` will be encoded as `&num;`. To get a more compact output,
 * consider using the `encodeNonAsciiHTML` function.
 *
 * If a character has no equivalent entity, a
 * numeric hexadecimal reference (eg. `&#xfc;`) will be used.
 */
export function encodeHTML(data: string): string {
    return encodeHTMLTrieRe(htmlReplacer, data);
}
/**
 * Encodes all non-ASCII characters, as well as characters not valid in HTML
 * documents using HTML entities.
 *
 * If a character has no equivalent entity, a
 * numeric hexadecimal reference (eg. `&#xfc;`) will be used.
 */
export function encodeNonAsciiHTML(data: string): string {
    return encodeHTMLTrieRe(xmlReplacer, data);
}

/**
 * Encodes all non-ASCII characters, as well as characters not valid in XML
 * documents using numeric hexadecimal reference (eg. `&#xfc;`).
 *
 * Have a look at `escapeUTF8` if you want a more concise output at the expense
 * of reduced transportability.
 *
 * @param data String to escape.
 */
export const escape = encodeXML;

/**
 * Encodes all characters not valid in XML documents using XML entities.
 *
 * Note that the output will be character-set dependent.
 *
 * @param data String to escape.
 */
export function escapeUTF8(data: string): string {
    let match;
    let lastIdx = 0;
    let result = "";

    while ((match = xmlInvalidChars.exec(data))) {
        if (lastIdx !== match.index) {
            result += data.substring(lastIdx, match.index);
        }

        // We know that this chararcter will be in `inverseXML`
        result += xmlCodeMap.get(match[0].charCodeAt(0))!;

        // Every match will be of length 1
        lastIdx = match.index + 1;
    }

    return result + data.substring(lastIdx);
}
