import xmlMap from "./maps/xml.json";

const inverseXML = getInverseObj(xmlMap);
const xmlReplacer = getInverseReplacer(inverseXML);

/**
 * Encodes all non-ASCII characters, as well as characters not valid in XML
 * documents using XML entities.
 *
 * If a character has no equivalent entity, a
 * numeric hexadecimal reference (eg. `&#xfc;`) will be used.
 */
export const encodeXML = getASCIIEncoder(inverseXML);

import htmlMap from "./maps/entities.json";

const inverseHTML = getInverseObj(htmlMap);
const htmlReplacer = getInverseReplacer(inverseHTML);

/**
 * Encodes all entities and non-ASCII characters in the input.
 *
 * This includes characters that are valid ASCII characters in HTML documents.
 * For example `#` will be encoded as `&num;`. To get a more compact output,
 * consider using the `encodeNonAsciiHTML` function.
 *
 * If a character has no equivalent entity, a
 * numeric hexadecimal reference (eg. `&#xfc;`) will be used.
 */
export const encodeHTML = getInverse(inverseHTML, htmlReplacer);
/**
 * Encodes all non-ASCII characters, as well as characters not valid in HTML
 * documents using HTML entities.
 *
 * If a character has no equivalent entity, a
 * numeric hexadecimal reference (eg. `&#xfc;`) will be used.
 */
export const encodeNonAsciiHTML = getASCIIEncoder(inverseHTML);

import { MapType } from "./decode";

function getInverseObj(obj: MapType): MapType {
    return Object.keys(obj)
        .sort()
        .reduce((inverse: MapType, name: string) => {
            inverse[obj[name]] = `&${name};`;
            return inverse;
        }, {});
}

function getInverseReplacer(inverse: MapType): RegExp {
    const single: string[] = [];
    const multiple: string[] = [];

    for (const k of Object.keys(inverse)) {
        if (k.length === 1) {
            // Add value to single array
            single.push(`\\${k}`);
        } else {
            // Add value to multiple array
            multiple.push(k);
        }
    }

    // Add ranges to single characters.
    single.sort();
    for (let start = 0; start < single.length - 1; start++) {
        // Find the end of a run of characters
        let end = start;
        while (
            end < single.length - 1 &&
            single[end].charCodeAt(1) + 1 === single[end + 1].charCodeAt(1)
        ) {
            end += 1;
        }

        const count = 1 + end - start;

        // We want to replace at least three characters
        if (count < 3) continue;

        single.splice(start, count, `${single[start]}-${single[end]}`);
    }

    multiple.unshift(`[${single.join("")}]`);

    return new RegExp(multiple.join("|"), "g");
}

// /[^\0-\x7F]/gu
const reNonASCII = /(?:[\x80-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])/g;

const getCodePoint =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    String.prototype.codePointAt != null
        ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          (str: string): number => str.codePointAt(0)!
        : // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
          (c: string): number =>
              (c.charCodeAt(0) - 0xd800) * 0x400 +
              c.charCodeAt(1) -
              0xdc00 +
              0x10000;

function singleCharReplacer(c: string): string {
    return `&#x${getCodePoint(c).toString(16).toUpperCase()};`;
}

function getInverse(inverse: MapType, re: RegExp) {
    return (data: string) =>
        data
            .replace(re, (name) => inverse[name])
            .replace(reNonASCII, singleCharReplacer);
}

const reEscapeChars = new RegExp(
    `${xmlReplacer.source}|${reNonASCII.source}`,
    "g"
);

/**
 * Encodes all non-ASCII characters, as well as characters not valid in XML
 * documents using numeric hexadecimal reference (eg. `&#xfc;`).
 *
 * Have a look at `escapeUTF8` if you want a more concise output at the expense
 * of reduced transportability.
 *
 * @param data String to escape.
 */
export function escape(data: string): string {
    return data.replace(reEscapeChars, singleCharReplacer);
}

/**
 * Encodes all characters not valid in XML documents using numeric hexadecimal
 * reference (eg. `&#xfc;`).
 *
 * Note that the output will be character-set dependent.
 *
 * @param data String to escape.
 */
export function escapeUTF8(data: string): string {
    return data.replace(xmlReplacer, singleCharReplacer);
}

function getASCIIEncoder(obj: MapType) {
    return (data: string) =>
        data.replace(reEscapeChars, (c) => obj[c] || singleCharReplacer(c));
}
