import htmlTrie from "./generated/encode-html";

const enum Surrogate {
    Mask = 0b1111_1100_0000_0000,
    High = 0b1101_1000_0000_0000,
}

function isHighSurrugate(c: number) {
    return (c & Surrogate.Mask) === Surrogate.High;
}

// For compatibility with node < 4, we wrap `codePointAt`
export const getCodePoint =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    String.prototype.codePointAt != null
        ? (str: string, index: number): number => str.codePointAt(index)!
        : // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
          (c: string, index: number): number =>
              isHighSurrugate(c.charCodeAt(index))
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
        const char = str.charCodeAt(i);
        let next = htmlTrie.get(char);

        if (next != null) {
            if (typeof next !== "string") {
                if (i + 1 < str.length) {
                    const value =
                        typeof next.n === "number"
                            ? next.n === str.charCodeAt(i + 1)
                                ? next.o
                                : null
                            : next.n.get(str.charCodeAt(i + 1));

                    if (value) {
                        ret += str.substring(lastIdx, i) + value;
                        lastIdx = regExp.lastIndex += 1;
                        continue;
                    }
                }

                // If we have a character without a value, use a numeric entitiy.
                next = next.v ?? `&#x${char.toString(16)};`;
            }

            ret += str.substring(lastIdx, i) + next;
            lastIdx = i + 1;
        } else {
            ret += `${str.substring(lastIdx, i)}&#x${getCodePoint(
                str,
                i
            ).toString(16)};`;
            // Increase by 1 if we have a surrogate pair
            lastIdx = regExp.lastIndex += Number(isHighSurrugate(char));
        }
    }

    return ret + str.substr(lastIdx);
}
