/*
 * Generates `src/generated/decode-data-html.ts`.
 *
 * The shipped decode data is two strings; the format and the rationale are
 * documented in `src/internal/decode-data-format.ts`. Everything the
 * runtime needs beyond these strings (hash tables, length classes, the
 * names blob) is rebuilt from them at module init. XML's five entities are
 * matched directly in `src/decode.ts` and need no generated data.
 *
 * Layout produced here:
 *
 *   asciiData = header(6) + suffixes + meta(2/name) + choices
 *   values    = concatenated replacement strings
 *
 * The only non-trivial build step is the cuckoo placement: every name's
 * exact key has two candidate buckets, and an augmenting-path matching
 * assigns each name one of them. The resulting choice ships as one bit per
 * name so init can place names without any searching.
 */

import { writeFileSync } from "node:fs";
import entityMap from "../maps/entities.json" with { type: "json" };
import legacyMap from "../maps/legacy.json" with { type: "json" };
import {
    bucketOne,
    bucketTwo,
    CHOICE_BITS_PER_CHAR,
    exactKey,
    HEADER_BIAS,
    META_BIAS,
} from "../src/internal/decode-data-format.js";

/**
 * Find a cuckoo placement for the given keys in `buckets` two-slot buckets
 * via augmenting paths. Returns the chosen bucket index per key, or null if
 * no placement exists at this size.
 * @param keys Exact keys in name order (duplicates allowed).
 * @param buckets Number of two-slot buckets.
 */
function findPlacement(keys: number[], buckets: number): Uint8Array | null {
    const candidates = keys.map((key) => {
        const b1 = bucketOne(key, buckets);
        const b2 = bucketTwo(key, buckets);
        return [2 * b1, 2 * b1 + 1, 2 * b2, 2 * b2 + 1];
    });
    const entityAt = new Int32Array(2 * buckets).fill(-1);
    const slotOf = new Int32Array(keys.length).fill(-1);
    const visited = new Uint8Array(2 * buckets);

    function canAugment(index: number): boolean {
        const slots = candidates[index];
        for (const slot of slots) {
            if (visited[slot] !== 0) continue;
            visited[slot] = 1;
            if (entityAt[slot] < 0 || canAugment(entityAt[slot])) {
                entityAt[slot] = index;
                slotOf[index] = slot;
                return true;
            }
        }
        return false;
    }

    for (let index = 0; index < keys.length; index++) {
        visited.fill(0);
        if (!canAugment(index)) return null;
    }

    const choices = new Uint8Array(keys.length);
    for (const [index, key] of keys.entries()) {
        const secondBucket = bucketTwo(key, buckets);
        choices[index] = slotOf[index] >> 1 === secondBucket ? 1 : 0;
    }
    return choices;
}

/**
 * Serialize one decode dataset.
 * @param entities Name → replacement value map (semicolon-less keys).
 * @param legacySet Names that also match without a trailing semicolon.
 */
function buildDecodeData(
    entities: Record<string, string>,
    legacySet: ReadonlySet<string>,
): [string, string] {
    /*
     * Sort by UTF-16 code unit — the default string-sort order the
     * front-coding and cuckoo placement were tuned against. `Number(a > b) -
     * Number(a < b)` yields -1/0/1 without a ternary, sidestepping
     * `prefer-simple-sort-comparator`, whose suggested subtraction is invalid
     * for strings.
     */
    // eslint-disable-next-line unicorn/no-array-sort -- `toSorted` is absent from the es2022 lib target; sorting this fresh `Object.keys` array in place is safe
    const names = Object.keys(entities).sort(
        (a, b) => Number(a > b) - Number(a < b),
    );

    let suffixes = "";
    let meta = "";
    let values = "";
    let previous = "";
    for (const name of names) {
        if (name.length < 2 || name.length > 31) {
            throw new Error(`Name length out of range: ${name}`);
        }
        const value = entities[name];
        if (value.length === 0 || value.length > 4) {
            throw new Error(`Value length out of range: ${name}`);
        }
        let prefixLength = 0;
        const max = Math.min(previous.length, name.length, 31);
        while (
            prefixLength < max &&
            previous.charCodeAt(prefixLength) === name.charCodeAt(prefixLength)
        ) {
            prefixLength++;
        }
        suffixes += name.slice(prefixLength);
        values += value;
        meta += String.fromCharCode(
            META_BIAS + (prefixLength | (legacySet.has(name) ? 0x20 : 0)),
            META_BIAS +
                ((name.length - prefixLength) | ((value.length - 1) << 5)),
        );
        previous = name;
    }

    /*
     * Smallest bucket count with a valid placement; ~83% load works for the
     * HTML set, the loop is a safety net for future data changes.
     */
    const keys = names.map((name) => exactKey(name, 0, name.length));
    let buckets = Math.max(4, Math.ceil(names.length / 1.66));
    let choiceBits = findPlacement(keys, buckets);
    while (choiceBits === null) {
        buckets += Math.max(1, buckets >> 6);
        if (buckets > names.length * 2) {
            throw new Error("Cuckoo placement failed");
        }
        choiceBits = findPlacement(keys, buckets);
    }

    let choices = "";
    for (let index = 0; index < names.length; index += CHOICE_BITS_PER_CHAR) {
        let packed = 0;
        for (
            let bit = 0;
            bit < CHOICE_BITS_PER_CHAR && index + bit < names.length;
            bit++
        ) {
            if (choiceBits[index + bit] !== 0) packed |= 1 << bit;
        }
        choices += String.fromCharCode(HEADER_BIAS + packed);
    }

    const header = String.fromCharCode(
        HEADER_BIAS + (names.length >> 6),
        HEADER_BIAS + (names.length & 63),
        HEADER_BIAS + (suffixes.length >> 6),
        HEADER_BIAS + (suffixes.length & 63),
        HEADER_BIAS + (buckets >> 6),
        HEADER_BIAS + (buckets & 63),
    );

    return [header + suffixes + meta + choices, values];
}

/**
 * Write one generated module.
 * @param fileName Output file name under src/generated.
 * @param exportName Exported constant name.
 * @param data Serialized dataset.
 */
function writeDataModule(
    fileName: string,
    exportName: string,
    data: [string, string],
): void {
    const out = `// Generated using scripts/write-decode-map.ts

/**
 * Serialized decode data; the format is documented in
 * \`src/internal/decode-data-format.ts\`. \`[0]\` is ASCII-only (header,
 * front-coded name suffixes, per-name metadata, cuckoo choice bits); \`[1]\`
 * holds the replacement values.
 */
// biome-ignore format: generated data
export const ${exportName}: readonly [string, string] = ${JSON.stringify(data)};
`;
    writeFileSync(
        new URL(`../src/generated/${fileName}`, import.meta.url),
        out,
    );
}

const legacyNames = new Set(Object.keys(legacyMap));
const htmlData = buildDecodeData(entityMap, legacyNames);
writeDataModule("decode-data-html.ts", "htmlDecodeData", htmlData);

console.log("Done!");
