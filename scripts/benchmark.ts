import he from "he";
import * as htmlEntities from "html-entities";
import { parseEntities } from "parse-entities";
import { Bench } from "tinybench";
import * as entities from "../src/index.js";

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

function printResults(title: string, bench: Bench) {
    // Build a compact table with key stats
    const rows = bench.tasks.map((t) => {
        const { hz, mean, rme } = t.result!;
        return {
            task: t.name,
            "ops/s": Number.isFinite(hz) ? hz.toFixed(0) : "-",
            "avg (μs)": Number.isFinite(mean) ? (mean * 1e6).toFixed(2) : "-",
            "±%": Number.isFinite(rme) ? rme.toFixed(2) : "-",
        };
    });
    console.log(`\n=== ${title} ===`);
    console.table(rows);
}

async function runCategory(
    title: string,
    input: string,
    tasks: [string, (s: string) => string][],
) {
    const bench = new Bench({ warmupTime: 1e3, time: 1e4 });
    for (const [name, run] of tasks) {
        bench.add(name, () => run(input));
    }
    await bench.run();
    printResults(title, bench);
}

await runCategory("Escaping", textToEncode, escapers);
await runCategory("Encoding", textToEncode, encoders);
await runCategory("Decoding", textToDecode, decoders);
