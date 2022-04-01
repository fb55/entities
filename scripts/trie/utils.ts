import { getTrie, TrieNode } from "./trie.js";
import { encodeTrie } from "./encode-trie.js";
import { BinTrieFlags } from "../../src/decode.js";
import xmlMap from "../../maps/xml.json";

/**
 * Utils for analzying the encoded trie.
 */

const decodeXMLMap = encodeTrie(getTrie(xmlMap, {}));
const parseCache = new Map<number, TrieNode>();

function parseNode(decodeMap: number[], startIndex: number): TrieNode {
    const cached = parseCache.get(startIndex);
    if (cached != null) return cached;
    let index = startIndex;
    const value = decodeMap[index++];
    const hasValue = value & BinTrieFlags.HAS_VALUE;
    const node: TrieNode = {
        value: hasValue
            ? value & BinTrieFlags.MULTI_BYTE
                ? String.fromCharCode(decodeMap[index++], decodeMap[index++])
                : String.fromCharCode(decodeMap[index++])
            : undefined,
        next: undefined,
    };

    parseCache.set(startIndex, node);

    const branchLength = (value & BinTrieFlags.BRANCH_LENGTH) >>> 8;

    if (branchLength) {
        const next = (node.next = new Map());
        if (branchLength === 1) {
            next.set(decodeMap[index++], parseNode(decodeMap, index));
        } else if (value & BinTrieFlags.JUMP_TABLE) {
            const offset = decodeMap[index++];

            for (let i = 0; i < branchLength; i++) {
                if (decodeMap[index] !== 0) {
                    const code = offset + i;
                    next.set(code, parseNode(decodeMap, decodeMap[index + i]));
                }
            }
        } else {
            for (let i = 0; i < branchLength; i++) {
                const char = decodeMap[index + i];
                const nextNode = parseNode(
                    decodeMap,
                    decodeMap[index + branchLength + i]
                );
                next.set(char, nextNode);
            }
        }
    }
    return node;
}

const printed = new Set();
function printTrie(trie: TrieNode, prefix = "") {
    if (printed.has(trie)) return;
    printed.add(trie);
    console.log(
        "prefix",
        prefix,
        "value",
        trie.value,
        "next size",
        trie.next?.size
    );
    if (trie.next) {
        trie.next.forEach((node, char) =>
            printTrie(node, prefix + String.fromCharCode(char))
        );
    }
}

const parsedXMLDecodedTrie = parseNode(decodeXMLMap, 0);
printTrie(parsedXMLDecodedTrie);
