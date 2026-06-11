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

/*
 * Matches exactly the characters `encodeXML` escapes: the five XML special
 * characters plus every non-ASCII code unit (lone surrogates included — no
 * `u` flag). Kept in sync with `XML_BITSET_VALUE`.
 */
const xmlEncodeRegex = /["&'<>\u0080-\uFFFF]/g;

/**
 * Encodes all non-ASCII characters, as well as characters not valid in XML
 * documents using XML entities.
 *
 * If a character has no equivalent entity, a numeric decimal reference
 * (eg. `&#252;`) will be used.
 * @param input Input string to encode or decode.
 */
export function encodeXML(input: string): string {
    const { length } = input;
    let out: string | undefined;
    let last = 0;
    let index = 0;

    while (index < length) {
        const char = input.charCodeAt(index);

        /*
         * Find the next character to escape: scan a short window inline
         * (escapable characters cluster in markup-heavy input), then fall
         * back to the regex, which skips clean spans in native code.
         */
        if (
            char < 0x80 &&
            (((XML_BITSET_VALUE >>> char) & 1) === 0 || char >= 64 || char < 32)
        ) {
            const bound = Math.min(index + 32, length);
            let next = index + 1;
            while (next < bound) {
                const code = input.charCodeAt(next);
                if (
                    code >= 0x80 ||
                    (((XML_BITSET_VALUE >>> code) & 1) === 1 &&
                        code < 64 &&
                        code >= 32)
                ) {
                    break;
                }
                next++;
            }
            if (next < bound) {
                index = next;
                continue;
            }
            if (next >= length) break;
            xmlEncodeRegex.lastIndex = next;
            const match = xmlEncodeRegex.exec(input);
            if (match === null) break;
            ({ index } = match);
            continue;
        }

        if (out === undefined) out = input.substring(0, index);
        else if (last !== index) out += input.substring(last, index);

        if (char < 64) {
            // Known replacement
            out += xmlCodeMap.get(char)!;
            last = index += 1;
            continue;
        }

        // Non-ASCII: encode as numeric entity (handle surrogate pair)
        const cp = input.codePointAt(index)!;
        out += `&#${cp};`;
        if (cp !== char) index++; // Skip trailing surrogate
        last = index += 1;
    }

    if (out === undefined) return input;
    if (last < length) out += input.substr(last);
    return out;
}

/**
 * Encodes all non-ASCII characters, as well as characters not valid in XML
 * documents using numeric decimal reference (eg. `&#252;`).
 *
 * Have a look at `escapeUTF8` if you want a more concise output at the expense
 * of reduced transportability.
 * @param data String to escape.
 */
export const escape: typeof encodeXML = encodeXML;

/**
 * Escape `data` using `re`, mapping each matched character to its entity.
 * @param re Global regex matching exactly the characters to escape
 *   (`"`, `&`, `'`, `<`, `>`, `\u00A0` at most).
 * @param data String to escape.
 */
function escapeWithRegex(re: RegExp, data: string): string {
    re.lastIndex = 0;
    let match = re.exec(data);
    if (match === null) return data;

    let out = "";
    let last = 0;
    do {
        const { index } = match;
        if (last !== index) out += data.substring(last, index);
        const char = data.charCodeAt(index);
        out +=
            char === 34
                ? "&quot;"
                : char === 38
                  ? "&amp;"
                  : char === 39
                    ? "&apos;"
                    : char === 60
                      ? "&lt;"
                      : char === 62
                        ? "&gt;"
                        : "&nbsp;";
        last = index + 1;
        match = re.exec(data);
    } while (match !== null);

    return out + data.substring(last);
}

const xmlEscapeRegex = /["&'<>]/g;
/**
 * Encodes all characters not valid in XML documents using XML entities.
 *
 * Note that the output will be character-set dependent.
 * @param data String to escape.
 */
export function escapeUTF8(data: string): string {
    return escapeWithRegex(xmlEscapeRegex, data);
}

const attributeEscapeRegex = /["&\u00A0]/g;

/**
 * Encodes all characters that have to be escaped in HTML attributes,
 * following {@link https://html.spec.whatwg.org/multipage/parsing.html#escapingString}.
 * @param data String to escape.
 */
export function escapeAttribute(data: string): string {
    return escapeWithRegex(attributeEscapeRegex, data);
}

const textEscapeRegex = /[&<>\u00A0]/g;

/**
 * Encodes all characters that have to be escaped in HTML text,
 * following {@link https://html.spec.whatwg.org/multipage/parsing.html#escapingString}.
 * @param data String to escape.
 */
export function escapeText(data: string): string {
    return escapeWithRegex(textEscapeRegex, data);
}
