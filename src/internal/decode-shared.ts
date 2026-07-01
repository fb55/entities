/**
 * Decode a dictionary-encoded trie string back into its Uint16Array.
 *
 * Stream layout (consumed in this order):
 *   1. dict1 atoms — `dict1AtomCount` uint16 values, delta+RLE encoded.
 *   2. dict2 atoms — `atomCount - dict1AtomCount` values, delta+RLE.
 *   3. dict2 ngrams — `ngramCount - (dictSize - dict1AtomCount)` entries,
 *      each a pair of slot codes that resolve to earlier slots.
 *   4. dict1 ngrams — `dictSize - dict1AtomCount` entries, same shape.
 *   5. data — slot codes, each expanding to one or more uint16 values.
 *
 * Codes use a 91-char base (printable ASCII minus `"`, `$`, `\`):
 *   - char1 < dictSize  → 1-char code, slot = char1
 *   - char1 ≥ dictSize  → 2-char code, slot = dictSize + (char1 - dictSize)*91 + char2
 *
 * Slot index → token kind:
 *   [0, A)                  dict1 atoms     (1-char codes)
 *   [A, dictSize)           dict1 ngrams    (1-char codes)
 *   [dictSize, dictSize+D)  dict2 atoms     (2-char codes)
 *   [dictSize+D, end)       dict2 ngrams    (2-char codes)
 *
 * Both atom dicts decode before any ngram, and dict2 ngrams decode before
 * dict1 ngrams. So every ngram entry references slots whose contents are
 * already filled — no forward references to handle.
 * @param input Packed trie string.
 * @param resultLength Expected number of uint16 values in the output.
 * @param atomCount Total number of distinct uint16 values in the trie.
 * @param dict1AtomCount Atoms in the 1-char range (`A` above).
 * @param ngramCount Total number of ngram entries (dict1 + dict2).
 * @param dictSize Number of 1-char code slots; the rest of `BASE - dictSize`
 *   first-byte values are 2-char codes.
 */
export function decodeTrieDict(
    input: string,
    resultLength: number,
    atomCount: number,
    dict1AtomCount: number,
    ngramCount: number,
    dictSize: number,
): Uint16Array {
    const base = 91;

    /*
     * Inverse of the encoder's SAFE alphabet (0x21..0x7E minus 0x22, 0x24,
     * 0x5C) computed inline: subtract one for each excluded code point we've
     * passed. The unary `+` coerces each boolean comparison to 0/1 — shorter
     * than `(c>n?1:0)` once minified.
     */
    const at = (index: number): number => {
        const c = input.charCodeAt(index);
        return c - 33 - +(c > 34) - +(c > 36) - +(c > 92);
    };

    let pos = 0;

    /** Read one slot code at `pos` and return its slot index, advancing pos. */
    const readSlotCode = (): number => {
        const c1 = at(pos++);
        return c1 < dictSize
            ? c1
            : dictSize + (c1 - dictSize) * base + at(pos++);
    };

    const dict2AtomCount = atomCount - dict1AtomCount;
    /*
     * Slots are plain `number[]`s — atoms are length-1, ngrams are
     * concatenations. Plain arrays minify smaller than `Uint16Array.of(v)` +
     * `Uint16Array(la+lb).set(...)` and are fine here since slot contents are
     * only ever pushed into the final `out: Uint16Array`.
     */
    // eslint-disable-next-line unicorn/no-new-array -- minifies smaller than Array.from({length})
    const slots: number[][] = new Array(atomCount + ngramCount);

    /**
     * Decode `count` ascending uint16 values from a delta+RLE stream into
     * `slots[off..off+count)` as length-1 arrays. Direct write avoids an
     * intermediate `number[]` and a follow-up `forEach` — saves bundle bytes.
     *
     *   code < 89   → delta = code
     *   code == 89  → run-length: next char encodes runLength-2; emit `runLength` consecutive +1 values
     *   code == 90, next < 90  → escape: delta = 89 + next * BASE + after-next
     *   code == 90, next == 90 → double-escape: extra char for very large deltas
     * @param count
     * @param off
     */
    function decodeDelta(count: number, off: number): void {
        let previous = 0;
        let index = 0;
        while (index < count) {
            const code = at(pos++);
            if (code < 89) {
                previous += code;
                slots[off + index++] = [previous];
            } else if (code === 89) {
                let runLength = at(pos++) + 2;
                while (runLength--) slots[off + index++] = [++previous];
            } else {
                const next = at(pos++);
                previous +=
                    89 +
                    // eslint-disable-next-line unicorn/prefer-minimal-ternary -- branches read a different number of side-effecting `at(pos++)` bytes
                    (next < 90
                        ? next * base + at(pos++)
                        : at(pos++) * 8281 + at(pos++) * base + at(pos++));
                slots[off + index++] = [previous];
            }
        }
    }

    // Streams 1 & 2: atoms decoded into their slot ranges.
    decodeDelta(dict1AtomCount, 0);
    decodeDelta(dict2AtomCount, dictSize);

    /**
     * Decode `count` ngram entries (each = 2 slot-code refs), placing the
     * concatenated values into `slots[startSlot + i]`.
     * @param count
     * @param startSlot
     */
    function decodeNgrams(count: number, startSlot: number): void {
        for (let index = 0; index < count; index++) {
            slots[startSlot + index] = [
                ...slots[readSlotCode()],
                ...slots[readSlotCode()],
            ];
        }
    }

    // Stream 3: dict2 ngrams (slots [dictSize+D, ...)).
    decodeNgrams(
        ngramCount - dictSize + dict1AtomCount,
        dictSize + dict2AtomCount,
    );
    /*
     * Stream 4: dict1 ngrams (slots [A, dictSize)) — last so they can refer
     * to any atom or any dict2 ngram already filled in.
     */
    decodeNgrams(dictSize - dict1AtomCount, dict1AtomCount);

    // Stream 5: data. Each code expands to its slot's stored values.
    const out = new Uint16Array(resultLength);
    let outIndex = 0;
    while (pos < input.length) {
        const slotValues = slots[readSlotCode()];
        for (const value of slotValues) out[outIndex++] = value;
    }
    return out;
}
