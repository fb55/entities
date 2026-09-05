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
 * slot without a forward reference. See `src/internal/decode-shared.ts` for
 * the runtime decoder, which must stay in sync with this encoder
 * (`encode-dict.spec.ts` round-trips the two).
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

/** Packs two uint16 token IDs into a numeric Map key. */
const PAIR_RADIX = 0x1_00_00;

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

/**
 * Count each atom's total use: standalone occurrences in `seq` plus uses as
 * a component inside ngram entries — every use pays its slot's code length.
 * @param seq Token sequence (atoms and ngram ids).
 * @param ngrams Ngram component pairs.
 * @param atomCount Number of atom token ids (ngram ids start here).
 */
function countAtomUse(
    seq: number[],
    ngrams: Pair[],
    atomCount: number,
): Int32Array {
    const use = new Int32Array(atomCount);
    for (const t of seq) if (t < atomCount) use[t]++;
    for (const [a, b] of ngrams) {
        if (a < atomCount) use[a]++;
        if (b < atomCount) use[b]++;
    }
    return use;
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

        const use = countAtomUse(seq, ngrams, atomCount);

        const atomsByUse = Array.from(
            { length: atomCount },
            (_, index) => index,
            // eslint-disable-next-line unicorn/no-array-sort -- TS lib doesn't expose toSorted yet
        ).sort((x, y) => use[y] - use[x]);

        codeLength = new Int8Array(totalTokens).fill(2);
        for (let rank = 0; rank < Math.min(dict1AtomCount, atomCount); rank++) {
            codeLength[atomsByUse[rank]] = 1;
        }
        for (const id of promotedNgrams) codeLength[id] = 1;

        // The atom that the next promotion would push out of dict1.
        demotedFreq =
            dict1AtomCount > 0 ? use[atomsByUse[dict1AtomCount - 1]] : 0;
    }
    refreshPartition();

    /*
     * Limit dictionary size and preserve repeated patterns for gzip/brotli.
     * BPE's raw character savings do not account for transport compression.
     */
    const BPE_MERGE_CAP = 25;
    for (let mergeCount = 0; mergeCount < BPE_MERGE_CAP; mergeCount++) {
        const counts = countPairs(seq);
        /*
         * Un-promoted ngrams always land in dict2 slots (>= dictSize),
         * which are 2-char codes by construction.
         */
        const dict2Length = 2;
        const canPromote = dictSize > promotedNgrams.size;

        // Greedy: track the highest-net candidate (first wins ties).
        let best: { net: number; a: number; b: number; promote: boolean } = {
            net: 0,
            a: 0,
            b: 0,
            promote: false,
        };
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
                : Number.NEGATIVE_INFINITY;
            const dict1Net = canPromote
                ? (sum - 1) * count - sum - demotedFreq
                : Number.NEGATIVE_INFINITY;
            const net = Math.max(dict1Net, dict2Net);
            if (net > best.net) {
                best = { net, a, b, promote: dict1Net > dict2Net };
            }
        }
        if (best.net <= 0) break;

        const newId = atomCount + ngrams.length;
        ngrams.push([best.a, best.b]);
        if (best.promote) promotedNgrams.add(newId);
        seq = replacePair(seq, best.a, best.b, newId);
        refreshPartition();
    }

    return { seq, ngrams, promotedNgrams };
}

// --- Encoding tries -------------------------------------------------------

/**
 * A dict+BPE-encoded trie plus the header values the runtime
 * `decodeTrieDict` needs to decode it (see the format comment at the top
 * of this file).
 */
export interface EncodedTrie {
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
 * @param data Uint16 trie words to encode.
 * @param dictSize Number of 1-char code slots.
 */
export function tryEncodeWithSplit(
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
     * Partition atoms into dict1 (top-use, 1-char) and dict2 (rest, 2-char).
     * Within each partition, sort by VALUE so the delta+RLE stream stays
     * compact. Total atom use = standalone uses + ngram-component uses.
     */
    const totalUse = countAtomUse(bpe.seq, bpe.ngrams, atomCount);
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
     * would over-read into the following streams and corrupt the trie. This
     * split doesn't fit the trie — report it like the other misfits so grid
     * scans (`encodeFullTrie`) fall through to a viable dictSize.
     */
    if (dict1AtomCount > atomCount) return null;
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
 * @param data Uint16 trie words to encode.
 */
export function encodeFullTrie(data: Uint16Array): EncodedTrie {
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
