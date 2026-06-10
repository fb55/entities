import { XML_BITSET_VALUE } from "./escape.js";
import htmlTrieData from "./generated/encode-html.js";

/**
 * A node inside the encoding trie used by `encode.ts`.
 *
 * There are two physical shapes to minimize allocations and lookup cost:
 *
 * 1. Leaf node (string)
 *    - A plain string (already in the form `"&name;"`).
 *    - Represents a terminal match with no children.
 *
 * 2. Branch / value node (object)
 */
type EncodeTrieNode =
    | string
    | { value: string | null; next: Map<number, EncodeTrieNode> };

/**
 * Flat lookup table for ASCII entity values (code points 0–127).
 *
 * Built once at startup from the full trie.  For ASCII characters that need
 * encoding, a direct `asciiEntities[charCode]` array index is much faster
 * than `Map.get(charCode)` because it avoids hashing and bucket lookup.
 *
 * A few ASCII characters also have multi-code-point children in the trie
 * (e.g. `<` + U+20D2 → `&nvlt;`).  The encoder checks the trie for those
 * multi-char matches first, then falls back to this table for the
 * single-char entity.
 */
const asciiEntities: (string | EncodeTrieNode | null)[] =
    /* #__PURE__ */ Array.from({ length: 128 }, () => null);

const htmlTrie: Map<number, EncodeTrieNode> = (() => {
    /**
     * Parse a compact encode trie string into a Map keyed by code point.
     *
     * The serialized format (produced by `scripts/write-encode-map.ts`) stores
     * entries in ascending code-point order with delta encoding:
     *
     *   [gap]name;[{children}]
     *
     * - `gap` is a base-10 integer giving `currentKey - previousKey - 1`.
     *   The very first entry stores the absolute key.  A gap of 0 is omitted.
     * - `name;` is the entity name (without `&` prefix) terminated by `;`.
     *   Because gaps use only digits `[0-9]` and entity names always start with
     *   a letter `[A-Za-z]`, no additional delimiter is needed.
     * - `{…}` is an optional children block using the same scheme recursively.
     *   Children represent the second code unit of multi-character entities
     *   (e.g. `<` + U+20D2 → `&nvlt;`).
     */
    const trie = new Map<number, EncodeTrieNode>();
    const data = htmlTrieData;
    let cursor = 0;
    let lastKey = -1;

    function readGap(): number {
        let value = 0;
        let ch: number;
        while (
            (ch = data.charCodeAt(cursor)) >= 48 /* '0' */ &&
            ch <= 57 /* '9' */
        ) {
            value = value * 10 + ch - 48;
            cursor++;
        }
        return value;
    }

    function readEntity(): string {
        const semi = data.indexOf(";", cursor);
        const entity = `&${data.substring(cursor, semi)};`;
        cursor = semi + 1;
        return entity;
    }

    const astralEntries: [number, string][] = [];

    while (cursor < data.length) {
        lastKey += readGap() + 1;

        const entityValue =
            data.charCodeAt(cursor) === 123 /* '{' */ ? null : readEntity();

        if (data.charCodeAt(cursor) === 123 /* '{' */) {
            cursor++; // Skip '{'
            const next = new Map<number, EncodeTrieNode>();
            let childKey = -1;
            while (data.charCodeAt(cursor) !== 125 /* '}' */) {
                childKey += readGap() + 1;
                next.set(childKey, readEntity());
            }
            const branch = { value: entityValue, next };
            trie.set(lastKey, branch);
            cursor++; // Skip '}'
            // ASCII fast path holds the branch node itself (children + value).
            if (lastKey < 0x80) {
                asciiEntities[lastKey] = branch;
            }
        } else if (lastKey < 0x80) {
            asciiEntities[lastKey] = entityValue;
        } else if (lastKey > 0xff_ff) {
            astralEntries.push([lastKey, entityValue!]);
        } else {
            trie.set(lastKey, entityValue!);
        }
    }

    /*
     * Batch-insert astral entries as surrogate-pair trie nodes.
     * Entries are sorted by code point, so same-high-surrogate groups
     * are contiguous — no intermediate grouping Map needed.
     */
    let astralIndex = 0;
    while (astralIndex < astralEntries.length) {
        const hi =
            0xd8_00 | ((astralEntries[astralIndex][0] - 0x1_00_00) >> 10);
        const children: [number, string][] = [];
        while (
            astralIndex < astralEntries.length &&
            (0xd8_00 | ((astralEntries[astralIndex][0] - 0x1_00_00) >> 10)) ===
                hi
        ) {
            const lo =
                0xdc_00 |
                ((astralEntries[astralIndex][0] - 0x1_00_00) & 0x3_ff);
            children.push([lo, astralEntries[astralIndex][1]]);
            astralIndex++;
        }
        trie.set(hi, { value: null, next: new Map(children) });
    }

    return trie;
})();

/**
 * Bitset covering ASCII code points 0–127.  Each of the four 32-bit words
 * covers a 32-code-point range.  A set bit means "this character needs
 * encoding" when used with `encodeHTML`.
 */
const HTML_BITSET = /* #__PURE__ */ new Uint32Array([
    0x16_00, // 09 (\t), 0A (\n), 0C (\f)
    0xfc_00_ff_fe, // 21-2D (!-.), 2E (.), 2F (/), 3A-3F (:;<=>?)
    0xf8_00_00_01, // 40 (@), 5B-5F ([\]^_)
    0x38_00_00_01, // 60 (`), 7B-7D ({|})
]);

const XML_BITSET = /* #__PURE__ */ new Uint32Array([0, XML_BITSET_VALUE, 0, 0]);

/*
 * Regex equivalents of the bitsets (plus all non-ASCII code units, lone
 * surrogates included — no `u` flag). Must stay in sync with the bitsets:
 * the scan uses the regex to find candidates and the bitset to re-check
 * adjacent characters.
 */
const HTML_ENCODE_RE = /[\t\n\f!-/:-@[-`{-}\u0080-\uFFFF]/g;
const XML_ENCODE_RE = /["&'<>\u0080-\uFFFF]/g;

const numericReference = (cp: number) => `&#${cp};`;

/**
 * Encodes all characters in the input using HTML entities. This includes
 * characters that are valid ASCII characters in HTML documents, such as `#`.
 *
 * To get a more compact output, consider using the `encodeNonAsciiHTML`
 * function, which will only encode characters that are not valid in HTML
 * documents, as well as non-ASCII characters.
 *
 * If a character has no equivalent entity, a numeric decimal reference
 * (eg. `&#252;`) will be used.
 * @param input Input string to encode or decode.
 */
export function encodeHTML(input: string): string {
    return encodeHTMLTrieRe(HTML_BITSET, HTML_ENCODE_RE, input);
}
/**
 * Encodes all non-ASCII characters, as well as characters not valid in HTML
 * documents using HTML entities. This function will not encode characters that
 * are valid in HTML documents, such as `#`.
 *
 * If a character has no equivalent entity, a numeric decimal reference
 * (eg. `&#252;`) will be used.
 * @param input Input string to encode or decode.
 */
export function encodeNonAsciiHTML(input: string): string {
    return encodeHTMLTrieRe(XML_BITSET, XML_ENCODE_RE, input);
}

function encodeHTMLTrieRe(
    bitset: Uint32Array,
    re: RegExp,
    input: string,
): string {
    const { length } = input;
    let out: string | undefined;
    let last = 0; // Start of the next untouched slice.
    let index = 0;
    let longGaps = false; // The previous gap was longer than the inline window.

    while (index < length) {
        const char = input.charCodeAt(index);

        /*
         * Find the next encodable character (one matching `bitset`, or any
         * non-ASCII unit). Gaps between entities in dense text are only a
         * few characters, so scan a short window inline first; the regex —
         * which matches exactly the same characters and skips clean spans
         * in native code — runs for longer gaps. Gap lengths cluster, so
         * after one regex-sized gap the window is skipped until a gap fits
         * it again.
         */
        if (char < 0x80 && !((bitset[char >>> 5] >>> char) & 1)) {
            let next = index + 1;
            if (!longGaps) {
                const bound = Math.min(index + 32, length);
                while (next < bound) {
                    const code = input.charCodeAt(next);
                    if (code >= 0x80 || (bitset[code >>> 5] >>> code) & 1) {
                        break;
                    }
                    next++;
                }
                if (next < bound) {
                    index = next;
                    continue;
                }
                if (next >= length) break;
            }
            /*
             * Every match is a single code unit, so `test` pins it at
             * `lastIndex - 1` without allocating a match object.
             */
            re.lastIndex = next;
            if (!re.test(input)) break;
            index = re.lastIndex - 1;
            longGaps = index - next >= 32;
            continue;
        }

        // Lazy-init: copy the prefix before the first character that needs encoding.
        if (out == null) out = input.substring(0, index);
        else if (last !== index) out += input.substring(last, index);

        if (char < 0x80) {
            const node = asciiEntities[char];
            if (typeof node === "object" && node !== null) {
                // Multi-code-point entity first (e.g. < + U+20D2 → &nvlt;).
                if (index + 1 < length) {
                    const value = node.next.get(input.charCodeAt(index + 1));
                    if (value != null) {
                        out += value;
                        last = index += 2;
                        continue;
                    }
                }
                out += node.value ?? numericReference(char);
            } else {
                out += node ?? numericReference(char);
            }
        } else {
            // Non-ASCII: full trie lookup with multi-char entity support.
            let node: EncodeTrieNode | undefined | null = htmlTrie.get(char);

            if (typeof node === "object") {
                if (index + 1 < length) {
                    const value = node.next.get(input.charCodeAt(index + 1));
                    if (value != null) {
                        out += value;
                        last = index += 2;
                        continue;
                    }
                }
                node = node.value;
            }

            if (node == null) {
                // No named entity exists; emit a decimal numeric reference.
                const cp = input.codePointAt(index)!;
                out += numericReference(cp);
                // Astral code points consume two UTF-16 code units.
                if (cp !== char) index++;
            } else {
                out += node;
            }
        }
        last = index += 1;
    }

    // If nothing needed encoding, return the original string (avoids allocation).
    if (out == null) return input;
    if (last < length) out += input.substr(last);
    return out;
}
