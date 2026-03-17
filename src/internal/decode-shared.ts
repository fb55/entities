/**
 * Shared base64 decode helper for generated decode data.
 * Assumes global atob is available.
 * @param input Input string to encode or decode.
 */
export function decodeBase64(input: string): Uint16Array {
    const binary: string =
        typeof atob === "function"
            ? // Browser (and Node >=16)

              atob(input)
            : // Older Node versions (<16)

              typeof Buffer.from === "function"
              ? Buffer.from(input, "base64").toString("binary")
              : // eslint-disable-next-line unicorn/no-new-buffer, n/no-deprecated-api
                new Buffer(input, "base64").toString("binary");

    const evenLength = binary.length & ~1; // Round down to even length
    const out = new Uint16Array(evenLength / 2);

    for (let index = 0, outIndex = 0; index < evenLength; index += 2) {
        const lo = binary.charCodeAt(index);
        const hi = binary.charCodeAt(index + 1);
        out[outIndex++] = lo | (hi << 8);
    }

    return out;
}
