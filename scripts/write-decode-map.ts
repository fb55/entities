import * as fs from "node:fs";
import entityMap from "../maps/entities.json" with { type: "json" };
import legacyMap from "../maps/legacy.json" with { type: "json" };
import xmlMap from "../maps/xml.json" with { type: "json" };
import { encodeTrie } from "./trie/encode-trie.js";
import { getTrie } from "./trie/trie.js";

function encodeUint16ArrayToBase64LittleEndian(data: Uint16Array): string {
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return buffer.toString("base64");
}

function generateFile(variableName: string, data: Uint16Array): string {
    const b64 = encodeUint16ArrayToBase64LittleEndian(data);
    return `// Generated using scripts/write-decode-map.ts

import { decodeBase64 } from "../internal/decode-shared.js";
export const ${variableName}: Uint16Array = /* #__PURE__ */ decodeBase64(
    ${JSON.stringify(b64)},
);`;
}

function convertMapToBinaryTrie(
    name: "html" | "xml",
    map: Record<string, string>,
    legacy: Record<string, string>,
) {
    const encoded = new Uint16Array(encodeTrie(getTrie(map, legacy), 2));
    const code = `${generateFile(`${name}DecodeTree`, encoded)}\n`;
    fs.writeFileSync(
        new URL(`../src/generated/decode-data-${name}.ts`, import.meta.url),
        code,
    );
}

convertMapToBinaryTrie("xml", xmlMap, {});
convertMapToBinaryTrie("html", entityMap, legacyMap);

console.log("Done!");
