import * as assert from "node:assert";
import * as fs from "node:fs";
import entityMap from "../maps/entities.json" with { type: "json" };
import html4Names from "../maps/html4.json" with { type: "json" };
import legacyMap from "../maps/legacy.json" with { type: "json" };
import xmlMap from "../maps/xml.json" with { type: "json" };
import { BinTrieFlags } from "../src/internal/bin-trie-flags.js";
import { type EncodedTrie, encodeFullTrie } from "./trie/encode-dict.js";
import { encodeTrie } from "./trie/encode-trie.js";
import { getTrie, type TrieNode } from "./trie/trie.js";

/*
 * Entities defined in HTML 4.01 (lat1, symbol, and special DTDs), from
 * maps/html4.json. These are the entities with decades of real-world usage
 * behind them — used as the "hot" set for trie encoding decisions, so their
 * lookup paths keep the fast jump-table encoding while the long tail of
 * rarely-used HTML5 names can use the more compact dictionary encoding.
 */
const HTML4_NAMES: string[] = html4Names;

/*
 * Staleness guard for `BPE_RANK_OVERRIDES` (scripts/trie/encode-dict.ts).
 * The overrides were tuned by coordinate descent against the exact HTML trie
 * contents, so they are stale the moment the trie changes. If this assert
 * fires: the encoding still round-trips correctly, but the overrides (and
 * this constant) should be re-tuned for the new data — re-run the tuning,
 * or reset the overrides to `{}` and compare bundle gzip/brotli sizes.
 */
const EXPECTED_HTML_ENCODED_LENGTH = 18_575;

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

/**
 * Count how many entities pass through each trie node (node "traffic").
 * Shared (deduplicated) subtree nodes accumulate counts from every path
 * that reaches them.
 * @param root The trie root.
 * @param keys The entity names inserted into the trie.
 */
function computeNodeTraffic(
    root: TrieNode,
    keys: string[],
): Map<TrieNode, number> {
    const traffic = new Map<TrieNode, number>([[root, keys.length]]);
    for (const key of keys) {
        let node = root;
        for (let index = 0; index < key.length; index++) {
            const next = node.next?.get(key.charCodeAt(index));
            // eslint-disable-next-line unicorn/no-break-in-nested-loop
            if (!next) break;
            node = next;
            traffic.set(node, (traffic.get(node) ?? 0) + 1);
        }
    }
    return traffic;
}

function convertMapToBinaryTrie(
    name: "html" | "xml",
    map: Record<string, string>,
    legacy: Record<string, string>,
) {
    /*
     * Hot/cold jump-table threshold: nodes on the lookup path of an HTML4
     * entity (the empirically common set) or with high entity traffic keep
     * `maxJumpTableOverhead=4` (jump tables: O(1) indexed read, handled
     * inline by the decoder's descent loop — −22% to −30% decode time on
     * entity-dense workloads). The long tail of rare HTML5 names uses the
     * compact linear-scan dictionary encoding instead, which keeps the
     * trie words (and the shipped bundle) smaller.
     */
    const hotTraffic = 16;
    const coldOverhead = 1.2;
    const trie = getTrie(map, legacy);
    const hotNodes = new Set<TrieNode>();
    for (const name of HTML4_NAMES) {
        let node: TrieNode | undefined = trie;
        hotNodes.add(node);
        for (let index = 0; index < name.length && node; index++) {
            node = node.next?.get(name.charCodeAt(index));
            if (node) hotNodes.add(node);
        }
    }
    const traffic = computeNodeTraffic(trie, Object.keys(map));
    const data = new Uint16Array(
        encodeTrie(trie, (node) =>
            hotNodes.has(node) || (traffic.get(node) ?? 0) >= hotTraffic
                ? 4
                : coldOverhead,
        ),
    );

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
    if (data.length < 100) {
        // Tiny tries (XML) skip the dict; ~25 values fits inline cheaply.
        file = generateInlineFile(name, data);
    } else {
        const result = encodeFullTrie(data);
        assert.strictEqual(
            result.encoded.length,
            EXPECTED_HTML_ENCODED_LENGTH,
            "Encoded HTML trie length changed — BPE_RANK_OVERRIDES (and " +
                "EXPECTED_HTML_ENCODED_LENGTH) are stale; see the comment " +
                "on the constant.",
        );
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
