import xmlMap from "./maps/xml.json";

const inverseXML = getInverseObj(xmlMap);
const xmlReplacer = getInverseReplacer(inverseXML);

export const encodeXML = getInverse(inverseXML, xmlReplacer);

import htmlMap from "./maps/entities.json";

const inverseHTML = getInverseObj(htmlMap);
const htmlReplacer = getInverseReplacer(inverseHTML);

export const encodeHTML = getInverse(inverseHTML, htmlReplacer);

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

    Object.keys(inverse).forEach(k =>
        k.length === 1
            ? // Add value to single array
              single.push(`\\${k}`)
            : // Add value to multiple array
              multiple.push(k)
    );

    //TODO add ranges
    multiple.unshift(`[${single.join("")}]`);

    return new RegExp(multiple.join("|"), "g");
}

const reNonASCII = /[^\0-\x7F]/g;
const reAstralSymbols = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

function singleCharReplacer(c: string): string {
    return `&#x${c
        .charCodeAt(0)
        .toString(16)
        .toUpperCase()};`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
function astralReplacer(c: string, _: any): string {
    // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
    const high = c.charCodeAt(0);
    const low = c.charCodeAt(1);
    const codePoint = (high - 0xd800) * 0x400 + low - 0xdc00 + 0x10000;
    return `&#x${codePoint.toString(16).toUpperCase()};`;
}

function getInverse(inverse: MapType, re: RegExp) {
    return (data: string) =>
        data
            .replace(re, name => inverse[name])
            .replace(reAstralSymbols, astralReplacer)
            .replace(reNonASCII, singleCharReplacer);
}

const reXmlChars = getInverseReplacer(inverseXML);

export function escape(data: string) {
    return data
        .replace(reXmlChars, singleCharReplacer)
        .replace(reAstralSymbols, astralReplacer)
        .replace(reNonASCII, singleCharReplacer);
}
