import * as fs from "node:fs";
import entityMap from "../maps/entities.json" with { type: "json" };
import html4Names from "../maps/html4.json" with { type: "json" };
import legacyMap from "../maps/legacy.json" with { type: "json" };
import xmlMap from "../maps/xml.json" with { type: "json" };
import { BinTrieFlags } from "../src/internal/bin-trie-flags.js";
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
 * --- Encoded format -------------------------------------------------------
 *
 * The trie data (a Uint16Array) is encoded as a JS string of printable ASCII
 * (91 chars: 0x21..0x7E minus `"`, `$`, `\`). Tokens are organised into:
 *
 *   atoms  — distinct uint16 values appearing in the data
 *   ngrams — BPE merges of two prior tokens (atoms or earlier ngrams)
 *
 * Each token sits in a slot indexed by code length:
 *
 *   slots [0,  A)            dict1 atoms     (1-char codes, top-`A` by use)
 *   slots [A,  dictSize)     dict1 ngrams    (1-char codes, promoted ngrams)
 *   slots [dictSize, end)    dict2 atoms then dict2 ngrams (both 2-char codes)
 *
 * Stream layout in the encoded string:
 *
 *   [dict1 atoms: delta+RLE]
 *   [dict2 atoms: delta+RLE]
 *   [dict2 ngrams: each = 2 prior code refs]
 *   [dict1 ngrams: each = 2 prior code refs]
 *   [data: stream of slot codes]
 *
 * Decoding both atom dicts before either ngram dict, and decoding dict2
 * ngrams before dict1 ngrams, lets every ngram entry reference any earlier
 * slot without a forward reference. See `src/internal/decode-shared.ts`.
 *
 * Compression comes from three layered effects:
 *   - Frequent atoms get 1-char slots (dict1).
 *   - BPE merges high-count pairs into ngrams that take fewer chars per use.
 *   - High-count merges may be _promoted_ into dict1 (1-char) by evicting the
 *     lowest-use dict1 atom; profitable when the per-use saving outweighs the
 *     evicted atom's per-use cost increase.
 *
 * The encoder constrains `dictSize + twoBytes = BASE`, so every slot code is
 * either 1 or 2 chars (no 3-char escape range). This keeps the runtime
 * decoder small and is sufficient as long as the trie fits in those slots.
 */

/** Printable ASCII chars safe in JS string literals (0x21..0x7E minus `"`, `$`, `\`). */
const SAFE: number[] = [];
for (let codePoint = 0x21; codePoint <= 0x7e; codePoint++) {
    if (codePoint !== 0x22 && codePoint !== 0x24 && codePoint !== 0x5c) {
        SAFE.push(codePoint);
    }
}
const BASE = SAFE.length; // 91

const RLE_MARKER = SAFE[89];
const ESCAPE = SAFE[90];

type Pair = readonly [number, number];

// --- Base-91 slot codes ---------------------------------------------------

/**
 * Length in chars of a code referring to slot `s`. With our constraint
 * `dictSize + twoBytes = BASE`, every slot code is 1 or 2 chars.
 * @param slot
 * @param dictSize
 */
function slotCodeLength(slot: number, dictSize: number): 1 | 2 {
    return slot < dictSize ? 1 : 2;
}

/**
 * Emit a code for slot `s` as a 1- or 2-char base-91 string.
 * @param slot
 * @param dictSize
 */
function emitSlotCode(slot: number, dictSize: number): string {
    if (slot < dictSize) return String.fromCharCode(SAFE[slot]);
    const r = slot - dictSize;
    return String.fromCharCode(
        SAFE[dictSize + Math.floor(r / BASE)],
        SAFE[r % BASE],
    );
}

// --- Delta + RLE encoding for the atom dict streams -----------------------

/**
 * Delta-encode a strictly-ascending list of integers as base-91 chars, with
 * run-length compression for consecutive +1 deltas.
 *
 *   delta < 89              → 1 char         SAFE[delta]
 *   run of `n` ones (n ≥ 3) → 2 chars/chunk  SAFE[89] SAFE[n-2]
 *   delta in [89, 8278]     → 3 chars        SAFE[90] SAFE[a] SAFE[b]
 *   larger delta            → 5 chars        SAFE[90] SAFE[90] SAFE[a] SAFE[b] SAFE[c]
 * @param values
 */
function deltaRleEncode(values: number[]): string {
    let out = "";
    let previous = 0;
    let index = 0;
    while (index < values.length) {
        const delta = values[index] - previous;
        // RLE for runs of three or more consecutive +1 deltas.
        if (delta === 1) {
            let runLength = 1;
            while (
                index + runLength < values.length &&
                values[index + runLength] - values[index + runLength - 1] === 1
            ) {
                runLength++;
            }
            if (runLength >= 3) {
                let remaining = runLength;
                while (remaining >= 3) {
                    const chunk = Math.min(remaining, BASE + 1);
                    out += String.fromCharCode(RLE_MARKER, SAFE[chunk - 2]);
                    remaining -= chunk;
                }
                for (let r = 0; r < remaining; r++) {
                    out += String.fromCharCode(SAFE[1]);
                }
                previous = values[index + runLength - 1];
                index += runLength;
                continue;
            }
        }
        if (delta < 89) {
            out += String.fromCharCode(SAFE[delta]);
        } else {
            const adjusted = delta - 89;
            out +=
                adjusted < 90 * BASE
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
    return out;
}

// --- BPE: merge token pairs into ngrams -----------------------------------

/** Encodes a pair (a, b) into a single number for use as Map keys. */
const PAIR_RADIX = 1_000_003;

/**
 * Count pair occurrences in `seq`. For pairs (a, b) with a !== b, overlapping
 * and non-overlapping counts coincide. For self-pairs (X, X), greedy
 * left-to-right replacement only takes floor(L/2) per run of length L, so we
 * count those properly per-run.
 * @param seq
 */
function countPairs(seq: number[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (let index = 0; index < seq.length - 1; index++) {
        const a = seq[index];
        const b = seq[index + 1];
        if (a === b) continue;
        const key = a * PAIR_RADIX + b;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (let index = 0; index < seq.length; ) {
        let end = index + 1;
        while (end < seq.length && seq[end] === seq[index]) end++;
        const length = end - index;
        if (length >= 2) {
            const key = seq[index] * PAIR_RADIX + seq[index];
            counts.set(key, (counts.get(key) ?? 0) + (length >> 1));
        }
        index = end;
    }
    return counts;
}

/**
 * Replace every non-overlapping occurrence of pair (a, b) in `seq` with the
 * single token `replacement`, returning a fresh array.
 * @param seq
 * @param a
 * @param b
 * @param replacement
 */
function replacePair(
    seq: number[],
    a: number,
    b: number,
    replacement: number,
): number[] {
    const out: number[] = [];
    for (let index = 0; index < seq.length; index++) {
        if (
            index + 1 < seq.length &&
            seq[index] === a &&
            seq[index + 1] === b
        ) {
            out.push(replacement);
            index++;
        } else {
            out.push(seq[index]);
        }
    }
    return out;
}

interface BpeResult {
    /** Token sequence after all merges have been applied. */
    seq: number[];
    /** Each ngram, in BPE-add order. ngram `k` has token id `atomCount + k`. */
    ngrams: Pair[];
    /** Token IDs of the ngrams that were promoted into 1-char dict1 codes. */
    promotedNgrams: Set<number>;
}

/**
 * Greedy BPE: iteratively merge the highest-saving pair until no merge yields
 * positive net savings.
 *
 * For each candidate pair (a, b) with `c` occurrences and code lengths
 * (`la`, `lb`), the loop considers two placements for the new ngram:
 *
 *   dict2 (2-char code, no demotion): net = (la + lb - 2) * c - (la + lb)
 *   dict1 (1-char code, demote 1 atom): net = (la + lb - 1) * c - (la + lb) - demotedFreq
 *
 * The dict2 placement is only legal when neither component is already a
 * dict1 ngram (forward references are forbidden — see decoder layout). The
 * pair + placement with highest positive net wins each iteration. After every
 * merge we recompute frequencies, code lengths, and `demotedFreq`.
 * @param initialSeq
 * @param atomCount
 * @param dictSize
 */
function bpeOptimize(
    initialSeq: number[],
    atomCount: number,
    dictSize: number,
): BpeResult {
    let seq = [...initialSeq];
    const ngrams: Pair[] = [];
    const promotedNgrams = new Set<number>();

    /** CodeLength[id] gets recomputed after every merge. */
    let codeLength = new Int8Array(0);
    let demotedFreq = 0;

    function refreshPartition() {
        const totalTokens = atomCount + ngrams.length;
        const dict1AtomCount = dictSize - promotedNgrams.size;

        /*
         * Atom use = standalone occurrences in `seq` plus uses as a component
         * inside ngram entries — every use pays its slot's code length.
         */
        const use = new Int32Array(atomCount);
        for (const t of seq) if (t < atomCount) use[t]++;
        for (const [a, b] of ngrams) {
            if (a < atomCount) use[a]++;
            if (b < atomCount) use[b]++;
        }

        const atomsByUse = Array.from(
            { length: atomCount },
            (_, index) => index,
            // eslint-disable-next-line unicorn/no-array-sort -- TS lib doesn't expose toSorted yet
        ).sort((x, y) => use[y] - use[x]);

        codeLength = new Int8Array(totalTokens);
        for (const [rank, id] of atomsByUse.entries()) {
            const slot =
                rank < dict1AtomCount
                    ? rank
                    : dictSize + (rank - dict1AtomCount);
            codeLength[id] = slotCodeLength(slot, dictSize);
        }
        /*
         * Each ngram's slot: 1-char if promoted, otherwise 2-char (or 3-char
         * if dict2 overflows). Within both kinds, slots increase in BPE order.
         */
        let nextDict1Slot = dict1AtomCount;
        let nextDict2Slot = dictSize + (atomCount - dict1AtomCount);
        for (const k of ngrams.keys()) {
            const id = atomCount + k;
            const slot = promotedNgrams.has(id)
                ? nextDict1Slot++
                : nextDict2Slot++;
            codeLength[id] = slotCodeLength(slot, dictSize);
        }

        // The atom that the next promotion would push out of dict1.
        demotedFreq =
            dict1AtomCount > 0 ? use[atomsByUse[dict1AtomCount - 1]] : 0;
    }
    refreshPartition();

    /*
     * Stop after `BPE_MERGE_CAP` merges, even if more would shrink raw bytes.
     * Empirically, shipping all profitable merges (~256 of them) shrinks the
     * minified bundle further but flattens the body's char-frequency
     * distribution enough that gzip and brotli on the bundled output _grow_
     * by 200–350 bytes vs. the baseline. Capping at ~25 keeps minified well
     * under baseline while letting gzip stay below and brotli within ~30
     * bytes — a much better wire-size trade for consumers that compress.
     */
    const BPE_MERGE_CAP = 25;
    /*
     * Brotli-aware overrides found by coordinate descent over the merge
     * sequence. At each listed step we pick the Nth-best candidate by net
     * raw savings instead of the greedy best, because the resulting merge
     * sequence yields better full-bundle brotli once the decoder + trie
     * are bundled. Re-tuned for the end-relative pointer data: worth -33
     * brotli bytes vs pure greedy at equal gzip.
     */
    const BPE_RANK_OVERRIDES: Record<number, number> = { 3: 2, 4: 5 };
    interface Candidate {
        net: number;
        a: number;
        b: number;
        promote: boolean;
    }
    for (let mergeCount = 0; mergeCount < BPE_MERGE_CAP; mergeCount++) {
        const counts = countPairs(seq);
        const dict2NgramSlot = atomCount + ngrams.length;
        const dict2Length = slotCodeLength(dict2NgramSlot, dictSize);
        const canPromote = dictSize > promotedNgrams.size;

        const candidates: Candidate[] = [];
        for (const [key, count] of counts) {
            // eslint-disable-next-line unicorn/no-break-in-nested-loop
            if (count < 2) continue;
            const a = Math.floor(key / PAIR_RADIX);
            const b = key % PAIR_RADIX;
            const sum = codeLength[a] + codeLength[b];
            const isDict2Allowed = !(
                promotedNgrams.has(a) || promotedNgrams.has(b)
            );

            const dict2Net = isDict2Allowed
                ? (sum - dict2Length) * count - sum
                : // eslint-disable-next-line unicorn/prefer-global-number-constants -- biome's useNumberNamespace enforces `Number.NEGATIVE_INFINITY`
                  Number.NEGATIVE_INFINITY;
            const dict1Net = canPromote
                ? (sum - 1) * count - sum - demotedFreq
                : // eslint-disable-next-line unicorn/prefer-global-number-constants -- biome's useNumberNamespace enforces `Number.NEGATIVE_INFINITY`
                  Number.NEGATIVE_INFINITY;
            const net = Math.max(dict1Net, dict2Net);
            if (net > 0) {
                candidates.push({
                    net,
                    a,
                    b,
                    promote: dict1Net > dict2Net,
                });
            }
        }
        if (candidates.length === 0) break;
        candidates.sort((x, y) => y.net - x.net);
        const rank = BPE_RANK_OVERRIDES[mergeCount] ?? 0;
        const best = candidates[Math.min(rank, candidates.length - 1)];

        const newId = atomCount + ngrams.length;
        ngrams.push([best.a, best.b]);
        if (best.promote) promotedNgrams.add(newId);
        seq = replacePair(seq, best.a, best.b, newId);
        refreshPartition();
    }

    return { seq, ngrams, promotedNgrams };
}

// --- Encoding tries -------------------------------------------------------

interface EncodedTrie {
    encoded: string;
    /** Number of distinct uint16 values stored across dict1 + dict2. */
    atomCount: number;
    /** Number of dict1 entries that are atoms (rest are promoted ngrams). */
    dict1AtomCount: number;
    ngramCount: number;
    dictSize: number;
}

/**
 * Encode the trie with a given `dictSize`: the top `dictSize` slots are
 * 1-char codes, and the remaining `BASE - dictSize` first-byte values are
 * 2-char codes. Returns `null` if the trie doesn't fit in this slot space.
 * @param data
 * @param dictSize
 */
function tryEncodeWithSplit(
    data: Uint16Array,
    dictSize: number,
): EncodedTrie | null {
    if (dictSize < 1 || dictSize >= BASE) return null;
    const capacity = dictSize + (BASE - dictSize) * BASE;

    // Map each distinct uint16 value to a token id.
    const valueToId = new Map<number, number>();
    const idToValue: number[] = [];
    for (const v of data) {
        if (valueToId.has(v)) {
            continue;
        }

        valueToId.set(v, idToValue.length);
        idToValue.push(v);
    }
    const atomCount = idToValue.length;
    if (capacity < atomCount) return null;

    const seq = Array.from(data, (v) => valueToId.get(v)!);
    const bpe = bpeOptimize(seq, atomCount, dictSize);
    if (atomCount + bpe.ngrams.length > capacity) return null;

    /*
     * Partition atoms into dict1 (top-use, 1-char) and dict2 (rest, 2-char or
     * 3-char). Within each partition, sort by VALUE so the delta+RLE stream
     * stays compact. Total atom use = standalone uses + ngram-component uses.
     */
    const totalUse = new Int32Array(atomCount);
    for (const t of bpe.seq) if (t < atomCount) totalUse[t]++;
    for (const [a, b] of bpe.ngrams) {
        if (a < atomCount) totalUse[a]++;
        if (b < atomCount) totalUse[b]++;
    }
    interface AtomEntry {
        id: number;
        value: number;
        use: number;
    }
    const atomEntries: AtomEntry[] = idToValue.map((value, id) => ({
        id,
        value,
        use: totalUse[id],
    }));
    atomEntries.sort((x, y) => y.use - x.use || x.value - y.value);

    const dict1AtomCount = dictSize - bpe.promotedNgrams.size;
    /*
     * `dict1 = atomEntries.slice(0, dict1AtomCount)` clamps to atomCount, but
     * the header still reports dict1AtomCount. If dict1AtomCount exceeded the
     * atoms actually emitted, the decoder's `decodeDelta(dict1AtomCount, 0)`
     * would over-read into the following streams and corrupt the trie.
     */
    if (dict1AtomCount > atomCount) {
        throw new Error(
            `dict1AtomCount (${dict1AtomCount}) exceeds the atom count ` +
                `(${atomCount}); the dict1 atom stream would under-fill and ` +
                "the decoder would over-read the following streams.",
        );
    }
    const byValue = (x: AtomEntry, y: AtomEntry) => x.value - y.value;
    // eslint-disable-next-line unicorn/no-array-sort -- TS lib doesn't expose toSorted yet
    const dict1 = atomEntries.slice(0, dict1AtomCount).sort(byValue);
    // eslint-disable-next-line unicorn/no-array-sort -- TS lib doesn't expose toSorted yet
    const dict2 = atomEntries.slice(dict1AtomCount).sort(byValue);

    // Slot for every token: atoms by partition+value-rank, ngrams by promotion+BPE-order.
    const slot = new Int32Array(atomCount + bpe.ngrams.length);
    for (const [index, entry] of dict1.entries()) slot[entry.id] = index;
    for (const [index, entry] of dict2.entries())
        slot[entry.id] = dictSize + index;
    let nextDict1NgramSlot = dict1AtomCount;
    let nextDict2NgramSlot = dictSize + dict2.length;
    for (let k = 0; k < bpe.ngrams.length; k++) {
        const id = atomCount + k;
        slot[id] = bpe.promotedNgrams.has(id)
            ? nextDict1NgramSlot++
            : nextDict2NgramSlot++;
    }

    const code = (id: number) => emitSlotCode(slot[id], dictSize);
    const dict1AtomHeader = deltaRleEncode(dict1.map((entry) => entry.value));
    const dict2AtomHeader = deltaRleEncode(dict2.map((entry) => entry.value));
    let dict1NgramHeader = "";
    let dict2NgramHeader = "";
    for (let k = 0; k < bpe.ngrams.length; k++) {
        const id = atomCount + k;
        const [a, b] = bpe.ngrams[k];
        const reference = code(a) + code(b);
        if (bpe.promotedNgrams.has(id)) dict1NgramHeader += reference;
        else dict2NgramHeader += reference;
    }
    let body = "";
    for (const t of bpe.seq) body += code(t);

    const encoded =
        dict1AtomHeader +
        dict2AtomHeader +
        dict2NgramHeader +
        dict1NgramHeader +
        body;
    return {
        encoded,
        atomCount,
        dict1AtomCount,
        ngramCount: bpe.ngrams.length,
        dictSize,
    };
}

/**
 * Try a range of dictSize values and return the smallest encoding. The grid
 * is narrow because the BPE inside `tryEncodeWithSplit` is the hot loop;
 * empirically the optimum lives in this range for the HTML entity trie.
 * @param data
 */
function encodeFullTrie(data: Uint16Array): EncodedTrie {
    let best: EncodedTrie | null = null;
    for (let dictSize = 45; dictSize <= 75; dictSize++) {
        const result = tryEncodeWithSplit(data, dictSize);
        if (result && (!best || result.encoded.length < best.encoded.length)) {
            best = result;
        }
    }
    if (!best) throw new Error("No viable dictSize split found.");
    return best;
}

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

    const file =
        // Tiny tries (XML) skip the dict; ~25 values fits inline cheaply.
        data.length < 100
            ? generateInlineFile(name, data)
            : generateDecoderFile(name, data, encodeFullTrie(data));
    fs.writeFileSync(
        new URL(`../src/generated/decode-data-${name}.ts`, import.meta.url),
        `${file}\n`,
    );
}

convertMapToBinaryTrie("xml", xmlMap, {});
convertMapToBinaryTrie("html", entityMap, legacyMap);

console.log("Done!");
