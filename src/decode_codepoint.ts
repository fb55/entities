import decodeMap from "./maps/decode.json";

// Adapted from https://github.com/mathiasbynens/he/blob/master/src/he.js#L94-L119

const fromCodePoint =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, node/no-unsupported-features/es-builtins
    String.fromCodePoint ||
    function (codePoint: number): string {
        let output = "";

        if (codePoint > 0xffff) {
            codePoint -= 0x10000;
            output += String.fromCharCode(
                ((codePoint >>> 10) & 0x3ff) | 0xd800
            );
            codePoint = 0xdc00 | (codePoint & 0x3ff);
        }

        output += String.fromCharCode(codePoint);
        return output;
    };

export default function decodeCodePoint(codePoint: number): string {
    if ((codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) {
        return "\uFFFD";
    }

    if (codePoint in decodeMap) {
        codePoint = (decodeMap as Record<string, number>)[codePoint];
    }

    return fromCodePoint(codePoint);
}
