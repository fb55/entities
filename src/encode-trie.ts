import htmlMap from "./maps/entities.json";

// For compatibility with node < 4, we wrap `codePointAt`
export const getCodePoint =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    String.prototype.codePointAt != null
        ? (str: string, index: number): number => str.codePointAt(index)!
        : // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
          (c: string, index: number): number =>
              (c.charCodeAt(index) & 0xd800) === 0xd800
                  ? (c.charCodeAt(index) - 0xd800) * 0x400 +
                    c.charCodeAt(index + 1) -
                    0xdc00 +
                    0x10000
                  : c.charCodeAt(index);

const htmlTrie = getTrie(htmlMap);

export function encodeHTMLTrieRe(regExp: RegExp, str: string): string {
    let ret = "";
    let lastIdx = 0;
    let match;

    while ((match = regExp.exec(str)) !== null) {
        const i = match.index;
        const char = str.charCodeAt(i);
        const next = htmlTrie.get(char);

        if (next) {
            if (next.next != null && i + 1 < str.length) {
                const value = next.next.get(str.charCodeAt(i + 1))?.value;
                if (value != null) {
                    ret += str.substring(lastIdx, i) + value;
                    regExp.lastIndex += 1;
                    lastIdx = i + 2;
                    continue;
                }
            }

            ret += str.substring(lastIdx, i) + next.value;
            lastIdx = i + 1;
        } else {
            ret += `${str.substring(lastIdx, i)}&#x${getCodePoint(
                str,
                i
            ).toString(16)};`;
            // Increase by 1 if we have a surrogate pair
            lastIdx = regExp.lastIndex += Number((char & 0xd800) === 0xd800);
        }
    }

    return ret + str.substr(lastIdx);
}

export interface TrieNode {
    value?: string;
    next?: Map<number, TrieNode>;
}

export function getTrie(map: Record<string, string>): Map<number, TrieNode> {
    const trie = new Map<number, TrieNode>();

    for (const value of Object.keys(map)) {
        const key = map[value];
        // Resolve the key
        let lastMap = trie;
        for (let i = 0; i < key.length - 1; i++) {
            const char = key.charCodeAt(i);
            const next = lastMap.get(char) ?? {};
            lastMap.set(char, next);
            lastMap = next.next ??= new Map();
        }
        const val = lastMap.get(key.charCodeAt(key.length - 1)) ?? {};
        val.value ??= `&${value};`;
        lastMap.set(key.charCodeAt(key.length - 1), val);
    }

    return trie;
}
