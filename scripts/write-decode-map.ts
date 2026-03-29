import * as fs from "node:fs";
import entityMap from "../maps/entities.json" with { type: "json" };
import legacyMap from "../maps/legacy.json" with { type: "json" };
import xmlMap from "../maps/xml.json" with { type: "json" };
import { encodeTrie } from "./trie/encode-trie.js";
import { getTrie } from "./trie/trie.js";

/**
 * Printable ASCII chars safe in JS string literals (0x21–0x7E minus `"`, `$`, `\`).
 * 91 chars. `$` is excluded to prevent `${` sequences that trip linters.
 */
const SAFE: number[] = [];
for (let codePoint = 0x21; codePoint <= 0x7e; codePoint++) {
    if (codePoint !== 0x22 && codePoint !== 0x24 && codePoint !== 0x5c) {
        SAFE.push(codePoint);
    }
}
const BASE = SAFE.length; // 91

/** Number of most-frequent values assigned to 1-char codes. */
const DICT_SIZE = 61;

/**
 * Encode trie data using dictionary + delta-encoded value table.
 *
 * Format: [dict1: D×3 chars][dict2: delta var-len][data]
 *
 * - dict1: the D most-frequent values, each as 3 base-91 chars.
 * - dict2: all remaining unique values, delta-encoded with variable-length base-91.
 *   Deltas < 90 → 1 char; 90–8370 → escape + 2 chars; larger → double-escape + 3 chars.
 * - data: each trie value encoded as 1 char (dict1 lookup) or 2 chars (dict2 lookup).
 *
 * This gives ~24% smaller raw and ~16% better gzip than base64.
 * @param data Trie data to encode.
 */
function encodeTrieData(data: Uint16Array): {
    encoded: string;
    headerLength: number;
} {
    // For small tries (e.g. XML), skip the dictionary and use plain var-len base91.
    if (data.length < 100) {
        const twoCharCount = 84;
        const split = twoCharCount * BASE;
        let result = "";
        for (const value of data) {
            if (value < split) {
                result += String.fromCharCode(
                    SAFE[Math.floor(value / BASE)],
                    SAFE[value % BASE],
                );
            } else {
                const adjusted = value - split;
                result += String.fromCharCode(
                    SAFE[twoCharCount + Math.floor(adjusted / (BASE * BASE))],
                    SAFE[Math.floor(adjusted / BASE) % BASE],
                    SAFE[adjusted % BASE],
                );
            }
        }
        return { encoded: result, headerLength: 0 };
    }

    // Count frequencies
    const freq = new Map<number, number>();
    for (const value of data) freq.set(value, (freq.get(value) ?? 0) + 1);
    // @ts-expect-error `toSorted` requires a lib bump.
    const sorted: [number, number][] = [...freq.entries()].toSorted(
        (a: [number, number], b: [number, number]) => b[1] - a[1],
    );

    // Dict1: top D values → 1-char codes, sorted ascending for delta encoding
    const dict1 = sorted
        .slice(0, DICT_SIZE)
        .map(([value]) => value)
        // eslint-disable-next-line unicorn/no-array-sort -- TS doesn't know toSorted
        .sort((a: number, b: number) => a - b);
    const dict1Set = new Set(dict1);

    // Dict2: remaining values, sorted ascending for delta encoding
    const dict2Sorted = sorted
        .filter(([value]: [number, number]) => !dict1Set.has(value))
        .map(([value]: [number, number]) => value)
        // eslint-disable-next-line unicorn/no-array-sort -- TS doesn't know toSorted
        .sort((a: number, b: number) => a - b);

    /*
     * Encode header: dict1 then dict2, each delta variable-length from 0.
     *
     * Encoding:
     *   delta < 89        → 1 char: SAFE[delta]
     *   SAFE[89]          → run-length marker: next char encodes N-2 (≥1),
     *                       meaning N consecutive delta-1 values
     *   SAFE[90]          → escape for large deltas (same as before but threshold 89)
     *   SAFE[90] SAFE[90] → double escape for very large deltas
     */
    const RLE_MARKER = SAFE[89];
    const ESCAPE = SAFE[90];
    let header = "";
    function deltaEncode(values: number[]) {
        let previous = 0;
        let index = 0;
        while (index < values.length) {
            const delta = values[index] - previous;
            if (delta === 1) {
                // Count consecutive delta=1 values
                let runLength = 1;
                while (
                    index + runLength < values.length &&
                    values[index + runLength] -
                        values[index + runLength - 1] ===
                        1
                ) {
                    runLength++;
                }
                if (runLength >= 3) {
                    // Emit RLE-encoded runs (max chunk = BASE+1=92, stored as SAFE[0..90])
                    let remaining = runLength;
                    while (remaining >= 3) {
                        const chunk = Math.min(remaining, BASE + 1);
                        header += String.fromCharCode(
                            RLE_MARKER,
                            SAFE[chunk - 2],
                        );
                        remaining -= chunk;
                    }
                    // Emit leftover 1-2 values as plain delta=1
                    for (let r = 0; r < remaining; r++) {
                        header += String.fromCharCode(SAFE[1]);
                    }
                    previous = values[index + runLength - 1];
                    index += runLength;
                    continue;
                }
            }
            // Non-run or short run: emit single delta
            if (delta < 89) {
                header += String.fromCharCode(SAFE[delta]);
            } else {
                const adjusted = delta - 89;
                header +=
                    adjusted < BASE * BASE
                        ? String.fromCharCode(
                              ESCAPE,
                              SAFE[Math.floor(adjusted / BASE)],
                              SAFE[adjusted % BASE],
                          )
                        : String.fromCharCode(
                              ESCAPE,
                              ESCAPE,
                              SAFE[Math.floor(adjusted / (BASE * BASE))],
                              SAFE[Math.floor(adjusted / BASE) % BASE],
                              SAFE[adjusted % BASE],
                          );
            }
            previous = values[index];
            index++;
        }
    }
    deltaEncode(dict1);
    deltaEncode(dict2Sorted);

    // Build value → code mapping
    const valueToCode = new Map<number, string>();
    for (let index = 0; index < DICT_SIZE; index++) {
        valueToCode.set(dict1[index], String.fromCharCode(SAFE[index]));
    }
    let codeIndex = 0;
    for (const value of dict2Sorted) {
        valueToCode.set(
            value,
            String.fromCharCode(
                SAFE[DICT_SIZE + Math.floor(codeIndex / BASE)],
                SAFE[codeIndex % BASE],
            ),
        );
        codeIndex++;
    }

    // Encode data
    let encodedData = "";
    for (const value of data) {
        encodedData += valueToCode.get(value);
    }

    return { encoded: header + encodedData, headerLength: header.length };
}

function formatNumber(value: number): string {
    return value >= 10_000
        ? value.toLocaleString("en").replaceAll(",", "_")
        : String(value);
}

function generateFile(name: string, data: Uint16Array): string {
    const { encoded, headerLength } = encodeTrieData(data);

    // For small tries, emit an inline literal array (no decoder import needed).
    if (headerLength === 0) {
        const values = [...data].map((v) => formatNumber(v)).join(", ");
        return `// Generated using scripts/write-decode-map.ts

/** Packed ${name.toUpperCase()} decode trie data. */
export const ${name}DecodeTree: Uint16Array = /* #__PURE__ */ new Uint16Array([
    ${values},
]);`;
    }

    return `// Generated using scripts/write-decode-map.ts

import { decodeTrieDict } from "../internal/decode-shared.js";
/** Packed ${name.toUpperCase()} decode trie data. */
export const ${name}DecodeTree: Uint16Array = /* #__PURE__ */ decodeTrieDict(
    ${JSON.stringify(encoded)},
    ${formatNumber(data.length)},
    ${formatNumber(headerLength)},
);`;
}

function convertMapToBinaryTrie(
    name: "html" | "xml",
    map: Record<string, string>,
    legacy: Record<string, string>,
) {
    const encoded = new Uint16Array(encodeTrie(getTrie(map, legacy), 1.2));
    const code = `${generateFile(name, encoded)}\n`;
    fs.writeFileSync(
        new URL(`../src/generated/decode-data-${name}.ts`, import.meta.url),
        code,
    );
}

convertMapToBinaryTrie("xml", xmlMap, {});
convertMapToBinaryTrie("html", entityMap, legacyMap);

console.log("Done!");
