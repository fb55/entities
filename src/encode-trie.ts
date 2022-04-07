import htmlTrie from "./generated/encode-html.js";

const enum Surrogate {
    Mask = 0b1111_1100_0000_0000,
    High = 0b1101_1000_0000_0000,
}

function isHighSurrogate(c: number) {
    return (c & Surrogate.Mask) === Surrogate.High;
}

// For compatibility with node < 4, we wrap `codePointAt`
export const getCodePoint =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    String.prototype.codePointAt != null
        ? (str: string, index: number): number => str.codePointAt(index)!
        : // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
          (c: string, index: number): number =>
              isHighSurrogate(c.charCodeAt(index))
                  ? (c.charCodeAt(index) - Surrogate.High) * 0x400 +
                    c.charCodeAt(index + 1) -
                    0xdc00 +
                    0x10000
                  : c.charCodeAt(index);

export function encodeHTMLTrieRe(regExp: RegExp, str: string): string {
    let ret = "";
    let lastIdx = 0;
    let match;

    while ((match = regExp.exec(str)) !== null) {
        const i = match.index;
        ret += str.substring(lastIdx, i);
        const char = str.charCodeAt(i);
        let next = htmlTrie.get(char);

        if (typeof next === "object") {
            // We are in a branch. Try to match the next char.
            if (i + 1 < str.length) {
                const nextChar = str.charCodeAt(i + 1);
                const value =
                    typeof next.n === "number"
                        ? next.n === nextChar
                            ? next.o
                            : undefined
                        : next.n.get(nextChar);

                if (value !== undefined) {
                    ret += value;
                    lastIdx = regExp.lastIndex += 1;
                    continue;
                }
            }

            next = next.v;
        }

        // We might have a tree node without a value; skip and use a numeric entitiy.
        if (next !== undefined) {
            ret += next;
            lastIdx = i + 1;
        } else {
            const cp = getCodePoint(str, i);
            ret += `&#x${cp.toString(16)};`;
            // Increase by 1 if we have a surrogate pair
            lastIdx = regExp.lastIndex += Number(cp !== char);
        }
    }

    return ret + str.substr(lastIdx);
}
