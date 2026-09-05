import * as fs from "node:fs";
import entityMap from "../maps/entities.json" with { type: "json" };
import legacyMap from "../maps/legacy.json" with { type: "json" };
import xmlMap from "../maps/xml.json" with { type: "json" };
import { BinTrieFlags } from "../src/internal/bin-trie-flags.js";
import { type EncodedTrie, encodeFullTrie } from "./trie/encode-dict.js";
import { encodeTrie } from "./trie/encode-trie.js";
import { getTrie } from "./trie/trie.js";

// --- File generation ------------------------------------------------------

function formatNumber(value: number): string {
    return value >= 10_000
        ? value.toLocaleString("en").replaceAll(",", "_")
        : String(value);
}

/**
 * Formatter line width — must match biome's configured width (the default,
 * 80) so `biome check` leaves the generated files untouched.
 */
const FORMAT_LINE_WIDTH = 80;
/** Max content chars per line: width minus 4-space indent and trailing comma. */
const FORMAT_CONTENT_WIDTH = FORMAT_LINE_WIDTH - 4 - 1;

function generateInlineFile(name: string, data: Uint16Array): string {
    /*
     * Greedily fill lines to the formatter's width, matching biome's array
     * formatting so the formatter leaves the generated file untouched.
     */
    const tokens = [...data].map((v) => formatNumber(v));
    const lines: string[] = [];
    let line = "";
    for (const token of tokens) {
        const piece = (line ? ", " : "") + token;
        if (line && line.length + piece.length > FORMAT_CONTENT_WIDTH) {
            lines.push(`${line},`);
            line = token;
        } else {
            line += piece;
        }
    }
    if (line) lines.push(`${line},`);
    const body = lines.map((l) => `    ${l}`).join("\n");
    return `// Generated using scripts/write-decode-map.ts

/** Packed ${name.toUpperCase()} decode trie data. */
export const ${name}DecodeTree: Uint16Array = /* #__PURE__ */ new Uint16Array([
${body}
]);`;
}

function generateDecoderFile(
    name: string,
    data: Uint16Array,
    result: EncodedTrie,
): string {
    return `// Generated using scripts/write-decode-map.ts

import { decodeTrieDict } from "../internal/decode-shared.js";
/** Packed ${name.toUpperCase()} decode trie data. */
export const ${name}DecodeTree: Uint16Array = /* #__PURE__ */ decodeTrieDict(
    ${JSON.stringify(result.encoded)},
    ${formatNumber(data.length)},
    ${formatNumber(result.atomCount)},
    ${formatNumber(result.dict1AtomCount)},
    ${formatNumber(result.ngramCount)},
    ${result.dictSize},
);`;
}

function convertMapToBinaryTrie(
    name: "html" | "xml",
    map: Record<string, string>,
    legacy: Record<string, string>,
) {
    /*
     * A uniform jump-table overhead budget of 4 favors O(1) dispatch.
     * Empty slots and small end-relative pointers compress in the dictionary.
     */
    const trie = getTrie(map, legacy);
    const data = new Uint16Array(encodeTrie(trie, 4));

    /*
     * `decodeWithTrie` (used for all HTML decoding) inlines root navigation
     * assuming the root header is a multi-branch jump table — it falls back
     * to rejecting every entity, not to a slow path, if the shape differs.
     * Fail the build instead of shipping a trie that silently never
     * matches. (The XML trie is exempt: `decodeXML` has a hand-coded fast
     * path and the streaming decoder handles any root shape.)
     */
    const rootJumpOffset = data[0] & BinTrieFlags.JUMP_TABLE;
    const rootBranchCount = (data[0] & BinTrieFlags.BRANCH_LENGTH) >> 7;
    /*
     * The decoder's inline root navigation also assumes the root carries no
     * value and is not a compact run; otherwise the descent loop is skipped
     * and every entity is rejected.
     */
    const hasRootValueOrRun =
        (data[0] & (BinTrieFlags.VALUE_LENGTH | BinTrieFlags.FLAG13)) !== 0;
    if (
        name === "html" &&
        (rootJumpOffset === 0 || rootBranchCount === 0 || hasRootValueOrRun)
    ) {
        throw new Error(
            "HTML trie root must be a value-less multi-branch jump table for " +
                "the decoder's inline root navigation; got header " +
                `0x${data[0].toString(16)}.`,
        );
    }

    let file: string;
    if (name === "xml") {
        // The tiny XML trie skips the dict; ~25 values fits inline cheaply.
        file = generateInlineFile(name, data);
    } else {
        const result = encodeFullTrie(data);
        file = generateDecoderFile(name, data, result);
    }
    fs.writeFileSync(
        new URL(`../src/generated/decode-data-${name}.ts`, import.meta.url),
        `${file}\n`,
    );
}

convertMapToBinaryTrie("xml", xmlMap, {});
convertMapToBinaryTrie("html", entityMap, legacyMap);

console.log("Done!");
