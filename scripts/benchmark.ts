/* eslint-disable node/no-missing-import */
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

const encoders: [string, (str: string) => string][] = [
    ["entities", (str: string) => entities.encodeHTML(str)],
    ["he", (str: string) => he.encode(str, heEscapeOptions)],
    [
        "html-entities",
        (str: string) =>
            htmlEntities.encode(str, htmlEntitiesHtml5EncodeOptions),
    ],
];

const htmlEntitiesHtml5DecodeOptions: htmlEntities.DecodeOptions = {
    level: "html5",
    scope: "body",
};

const decoders: [string, (str: string) => string][] = [
    ["entities", (str: string) => entities.decodeHTML(str)],
    ["he", (str: string) => he.decode(str)],
    ["parse-entities", (str: string) => parseEntities(str)],
    [
        "html-entities",
        (str: string) =>
            htmlEntities.decode(str, htmlEntitiesHtml5DecodeOptions),
    ],
];

const htmlEntitiesXmlEncodeOptions: htmlEntities.EncodeOptions = {
    level: "xml",
    mode: "specialChars",
};

const escapers: [string, (str: string) => string][] = [
    ["entities", (str: string) => entities.escapeUTF8(str)],
    ["he", (str: string) => he.escape(str)],
    // Html-entities cannot escape, so we use its simplest mode.
    [
        "html-entities",
        (str: string) => htmlEntities.encode(str, htmlEntitiesXmlEncodeOptions),
    ],
];

const textToDecode = `This is a simple text &uuml;ber &#x${"?"
    .charCodeAt(0)
    .toString(16)}; something.`;

const textToEncode = `über & unter's sprießende <boo> ❤️👊😉`;

console.log(
    "Escaping results",
    escapers.map(([name, escape]) => [name, escape(textToEncode)])
);

console.log(
    "Encoding results",
    encoders.map(([name, encode]) => [name, encode(textToEncode)])
);

console.log(
    "Decoding results",
    decoders.map(([name, decode]) => [name, decode(textToDecode)])
);

for (const [name, escape] of escapers) {
    console.time(`Escaping ${name}`);
    for (let i = 0; i < RUNS; i++) {
        escape(textToEncode);
    }
    console.timeEnd(`Escaping ${name}`);
}

for (const [name, encode] of encoders) {
    console.time(`Encoding ${name}`);
    for (let i = 0; i < RUNS; i++) {
        encode(textToEncode);
    }
    console.timeEnd(`Encoding ${name}`);
}

for (const [name, decode] of decoders) {
    console.time(`Decoding ${name}`);
    for (let i = 0; i < RUNS; i++) {
        decode(textToDecode);
    }
    console.timeEnd(`Decoding ${name}`);
}
