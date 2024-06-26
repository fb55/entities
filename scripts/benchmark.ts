/* eslint-disable n/no-missing-import */
import * as entities from "../";
import * as he from "he";
import { parseEntities } from "parse-entities";
import * as htmlEntities from "html-entities";

const RUNS = 1e7;

const htmlEntitiesHtml5EncodeOptions: htmlEntities.EncodeOptions = {
    level: "html5",
    mode: "nonAsciiPrintable",
};

const heEscapeOptions = { useNamedReferences: true };

const encoders: [string, (stringToEncode: string) => string][] = [
    ["entities", (stringToEncode) => entities.encodeHTML(stringToEncode)],
    ["he", (stringToEncode) => he.encode(stringToEncode, heEscapeOptions)],
    [
        "html-entities",
        (stringToEncode) =>
            htmlEntities.encode(stringToEncode, htmlEntitiesHtml5EncodeOptions),
    ],
];

const htmlEntitiesHtml5DecodeOptions: htmlEntities.DecodeOptions = {
    level: "html5",
    scope: "body",
};

const decoders: [string, (stringToDecode: string) => string][] = [
    ["entities", (stringToDecode) => entities.decodeHTML(stringToDecode)],
    ["he", (stringToDecode) => he.decode(stringToDecode)],
    ["parse-entities", (stringToDecode) => parseEntities(stringToDecode)],
    [
        "html-entities",
        (stringToDecode) =>
            htmlEntities.decode(stringToDecode, htmlEntitiesHtml5DecodeOptions),
    ],
];

const htmlEntitiesXmlEncodeOptions: htmlEntities.EncodeOptions = {
    level: "xml",
    mode: "specialChars",
};

const escapers: [string, (escapee: string) => string][] = [
    ["entities", (escapee) => entities.escapeUTF8(escapee)],
    ["he", (escapee) => he.escape(escapee)],
    // Html-entities cannot escape, so we use its simplest mode.
    [
        "html-entities",
        (escapee) => htmlEntities.encode(escapee, htmlEntitiesXmlEncodeOptions),
    ],
];

const textToDecode = `This is a simple text &uuml;ber &#x${"?"
    .charCodeAt(0)
    .toString(16)}; something.`;

const textToEncode = `über & unter's sprießende <boo> ❤️👊😉`;

console.log(
    "Escaping results",
    escapers.map(([name, escape]) => [name, escape(textToEncode)]),
);

console.log(
    "Encoding results",
    encoders.map(([name, encode]) => [name, encode(textToEncode)]),
);

console.log(
    "Decoding results",
    decoders.map(([name, decode]) => [name, decode(textToDecode)]),
);

for (const [name, escape] of escapers) {
    console.time(`Escaping ${name}`);
    for (let index = 0; index < RUNS; index++) {
        escape(textToEncode);
    }
    console.timeEnd(`Escaping ${name}`);
}

for (const [name, encode] of encoders) {
    console.time(`Encoding ${name}`);
    for (let index = 0; index < RUNS; index++) {
        encode(textToEncode);
    }
    console.timeEnd(`Encoding ${name}`);
}

for (const [name, decode] of decoders) {
    console.time(`Decoding ${name}`);
    for (let index = 0; index < RUNS; index++) {
        decode(textToDecode);
    }
    console.timeEnd(`Decoding ${name}`);
}
