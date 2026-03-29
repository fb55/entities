const xmlCodeMap = new Map([
    [34, "&quot;"],
    [38, "&amp;"],
    [39, "&apos;"],
    [60, "&lt;"],
    [62, "&gt;"],
]);

/**
 * Bitset for ASCII characters that need to be escaped in XML.
 */
export const XML_BITSET_VALUE = 0x50_00_00_c4; // 32..63 -> 34 ("),38 (&),39 ('),60 (<),62 (>)

/**
 * Encodes all non-ASCII characters, as well as characters not valid in XML
 * documents using XML entities. Uses a fast bitset scan instead of RegExp.
 *
 * If a character has no equivalent entity, a numeric hexadecimal reference
 * (eg. `&#xfc;`) will be used.
 * @param input Input string to encode or decode.
 */
export function encodeXML(input: string): string {
    let out: string | undefined;
    let last = 0;
    const { length } = input;

    for (let index = 0; index < length; index++) {
        const char = input.charCodeAt(index);

        // Check for ASCII chars that don't need escaping
        if (
            char < 0x80 &&
            (((XML_BITSET_VALUE >>> char) & 1) === 0 || char >= 64 || char < 32)
        ) {
            continue;
        }

        if (out === undefined) out = input.substring(0, index);
        else if (last !== index) out += input.substring(last, index);

        if (char < 64) {
            // Known replacement
            out += xmlCodeMap.get(char)!;
            last = index + 1;
            continue;
        }

        // Non-ASCII: encode as numeric entity (handle surrogate pair)
        const cp = input.codePointAt(index)!;
        out += `&#x${cp.toString(16)};`;
        if (cp !== char) index++; // Skip trailing surrogate
        last = index + 1;
    }

    if (out === undefined) return input;
    if (last < length) out += input.substr(last);
    return out;
}

/**
 * Encodes all non-ASCII characters, as well as characters not valid in XML
 * documents using numeric hexadecimal reference (eg. `&#xfc;`).
 *
 * Have a look at `escapeUTF8` if you want a more concise output at the expense
 * of reduced transportability.
 * @param data String to escape.
 */
export const escape: typeof encodeXML = encodeXML;

/**
 * Encodes all characters not valid in XML documents using XML entities.
 *
 * Note that the output will be character-set dependent.
 * @param c String to escape.
 */
function escapeReplacer(c: string): string {
    switch (c) {
        case '"': {
            return "&quot;";
        }
        case "&": {
            return "&amp;";
        }
        case "'": {
            return "&apos;";
        }
        case "<": {
            return "&lt;";
        }
        case ">": {
            return "&gt;";
        }
        case "\u00A0": {
            return "&nbsp;";
        }
    }
    return c;
}

const xmlEscapeRegex = /["&'<>]/g;
/**
 * Encodes all characters not valid in XML documents using XML entities.
 *
 * Note that the output will be character-set dependent.
 * @param data String to escape.
 */
export function escapeUTF8(data: string): string {
    return data.replace(xmlEscapeRegex, escapeReplacer);
}

const attributeEscapeRegex = /["&\u00A0]/g;

/**
 * Encodes all characters that have to be escaped in HTML attributes,
 * following {@link https://html.spec.whatwg.org/multipage/parsing.html#escapingString}.
 * @param data String to escape.
 */
export function escapeAttribute(data: string): string {
    return data.replace(attributeEscapeRegex, escapeReplacer);
}

const textEscapeRegex = /[&<>\u00A0]/g;

/**
 * Encodes all characters that have to be escaped in HTML text,
 * following {@link https://html.spec.whatwg.org/multipage/parsing.html#escapingString}.
 * @param data String to escape.
 */
export function escapeText(data: string): string {
    return data.replace(textEscapeRegex, escapeReplacer);
}
