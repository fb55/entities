import { JUMP_OFFSET_BASE } from "./../../src/decode";
import { getTrie, TrieNode } from "./trie";
import { encodeTrie } from "./encode-trie";
import { BinTrieFlags } from "../../src/decode";
import xmlMap from "../../src/maps/xml.json";

/**
 * Utils for analzying the encoded trie.
 */

const decodeXMLMap = encodeTrie(getTrie(xmlMap, {}));
const parseCache = new Map<number, TrieNode>();

function parseNode(decodeMap: number[], startIndex: number): TrieNode {
    const cached = parseCache.get(startIndex);
    if (cached != null) return cached;
    let index = startIndex;
    let postfix = "";
    while (decodeMap[index] < 128) {
        postfix += String.fromCharCode(decodeMap[index++]);
    }
    const value = decodeMap[index++];
    const hasValue = value & BinTrieFlags.HAS_VALUE;
    const isNumber = value & BinTrieFlags.IS_NUMBER;
    const node: TrieNode = {
        postfix,
        value:
            hasValue && !isNumber
                ? value & BinTrieFlags.HEX_OR_MULTI_BYTE
                    ? String.fromCharCode(
                          decodeMap[index++],
                          decodeMap[index++]
                      )
                    : String.fromCharCode(decodeMap[index++])
                : undefined,
        base:
            hasValue && isNumber
                ? value & BinTrieFlags.HEX_OR_MULTI_BYTE
                    ? 16
                    : 10
                : undefined,
        legacy: !!(value & BinTrieFlags.LEGACY),
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
                    const code = JUMP_OFFSET_BASE + offset + i;
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
        "postfix",
        trie.postfix,
        "value",
        trie.value,
        "base",
        trie.base,
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
console.log(printTrie(parsedXMLDecodedTrie));
