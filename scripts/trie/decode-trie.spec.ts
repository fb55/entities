import { describe, expect, it } from "vitest";
import entityMap from "../../maps/entities.json" with { type: "json" };
import legacyMap from "../../maps/legacy.json" with { type: "json" };
import xmlMap from "../../maps/xml.json" with { type: "json" };
import { decodeNode } from "./decode-trie.js";
import { encodeTrie } from "./encode-trie.js";
import { getTrie } from "./trie.js";

function decode(decodeMap: number[]) {
    const map = {};
    decodeNode(decodeMap, map, "", 0);

    return map;
}

function mergeMaps(
    map: Record<string, string>,
    legacy: Record<string, string>,
): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
        if (Object.hasOwn(legacy, k)) {
            // Legacy: unsuffixed only (`;` handled implicitly by decoder, not stored in trie)
            merged[k] = v;
        } else {
            // Strict: suffixed only (`;` required via FLAG13)
            merged[`${k};`] = v;
        }
    }

    return merged;
}

describe("decode_trie", () => {
    it("should decode an empty node", () =>
        expect(decode([0b0000_0000_0000_0000])).toStrictEqual({}));

    it("should decode an empty encode", () =>
        expect(decode(encodeTrie({}))).toStrictEqual({}));

    it("should decode a node with a value", () =>
        expect(decode(encodeTrie({ value: "a" }))).toStrictEqual({ "": "a" }));

    it("should decode a node with a multi-byte value", () =>
        expect(decode(encodeTrie({ value: "ab" }))).toStrictEqual({
            "": "ab",
        }));

    it("should decode a branch of size 1", () => {
        const encoded = encodeTrie({
            next: new Map([["b".charCodeAt(0), { value: "a" }]]),
        });
        expect(decode(encoded)).toStrictEqual({ b: "a" });
    });

    it("should decode a dictionary of size 2", () => {
        const encoded = encodeTrie({
            next: new Map([
                ["A".charCodeAt(0), { value: "a" }],
                ["b".charCodeAt(0), { value: "B" }],
            ]),
        });
        expect(decode(encoded)).toStrictEqual({ A: "a", b: "B" });
    });

    it("should decode a jump table of size 2", () => {
        const encoded = encodeTrie({
            next: new Map([
                ["a".charCodeAt(0), { value: "a" }],
                ["b".charCodeAt(0), { value: "B" }],
            ]),
        });
        expect(decode(encoded)).toStrictEqual({ a: "a", b: "B" });
    });

    it("should decode the XML map", () => {
        const encoded = encodeTrie(getTrie(xmlMap, {}));
        expect(decode(encoded)).toStrictEqual(mergeMaps(xmlMap, {}));
    });

    it("should decode the HTML map", () => {
        const encoded = encodeTrie(getTrie(entityMap, legacyMap));
        expect(decode(encoded)).toStrictEqual(mergeMaps(entityMap, legacyMap));
    });
});
