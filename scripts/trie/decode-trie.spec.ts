import { describe, it, expect } from "vitest";
import { encodeTrie } from "./encode-trie.js";
import { decodeNode } from "./decode-trie.js";
import { getTrie } from "./trie.js";
import xmlMap from "../../maps/xml.json" with { type: "json" };
import entityMap from "../../maps/entities.json" with { type: "json" };
import legacyMap from "../../maps/legacy.json" with { type: "json" };

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
    for (const [k, v] of Object.entries(map)) merged[`${k};`] = v; // Strict default
    for (const [k, v] of Object.entries(legacy)) {
        merged[k] = v; // Legacy unsuffixed
        merged[`${k};`] = v; // And suffixed
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

    it("should decode a branch of size 1", () =>
        expect(
            decode(
                encodeTrie({
                    next: new Map([["b".charCodeAt(0), { value: "a" }]]),
                }),
            ),
        ).toStrictEqual({ b: "a" }));

    it("should decode a dictionary of size 2", () =>
        expect(
            decode(
                encodeTrie({
                    next: new Map([
                        ["A".charCodeAt(0), { value: "a" }],
                        ["b".charCodeAt(0), { value: "B" }],
                    ]),
                }),
            ),
        ).toStrictEqual({ A: "a", b: "B" }));

    it("should decode a jump table of size 2", () =>
        expect(
            decode(
                encodeTrie({
                    next: new Map([
                        ["a".charCodeAt(0), { value: "a" }],
                        ["b".charCodeAt(0), { value: "B" }],
                    ]),
                }),
            ),
        ).toStrictEqual({ a: "a", b: "B" }));

    it("should decode the XML map", () =>
        expect(decode(encodeTrie(getTrie(xmlMap, {})))).toStrictEqual(
            mergeMaps(xmlMap, {}),
        ));

    it("should decode the HTML map", () =>
        expect(decode(encodeTrie(getTrie(entityMap, legacyMap)))).toStrictEqual(
            mergeMaps(entityMap, legacyMap),
        ));
});
