/* eslint-disable node/no-missing-import */
import * as entities from "../";
import he from "he";
import parseEntities from "parse-entities";
import * as htmlEntities from "html-entities";

const RUNS = 1e7;

const encoders: [string, (str: string) => string][] = [
    ["entities", (str: string) => entities.encodeHTML(str)],
    ["he", (str: string) => he.encode(str)],
    [
        "html-entities",
        (str: string) => htmlEntities.AllHtmlEntities.encode(str),
    ],
];

const decoders: [string, (str: string) => string][] = [
    ["entities", (str: string) => entities.decodeHTML(str)],
    ["he", (str: string) => he.decode(str)],
    ["parse-entities", (str: string) => parseEntities(str)],
    [
        "html-entities",
        (str: string) => htmlEntities.AllHtmlEntities.decode(str),
    ],
];

/*
 * Note: Not shown on the README, as `entities` differs in behavior from other libraries.
 * `entities` produces ASCII output, while other libraries only escape characters.
 */
const escapers: [string, (str: string) => string][] = [
    ["entities", (str: string) => entities.encodeXML(str)],
    ["he", (str: string) => he.escape(str)],
    // Html-entities cannot escape, so we use its simplest mode.
    ["html-entities", (str: string) => htmlEntities.XmlEntities.encode(str)],
];

const textToDecode = `This is a simple text &uuml;ber &#x${"?"
    .charCodeAt(0)
    .toString(16)}; something.`;

const textToEncode = `über & unter's sprießende <boo>`;

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
