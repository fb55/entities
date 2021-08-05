import * as fs from "fs";
import entityMap from "../src/maps/entities.json";
import legacyMap from "../src/maps/legacy.json";
import xmlMap from "../src/maps/xml.json";

import { getTrie } from "./trie/trie";
import { encodeTrie } from "./trie/encode-trie";

function convertMapToBinaryTrie(
    name: string,
    map: Record<string, string>,
    legacy: Record<string, string>
) {
    const encoded = encodeTrie(getTrie(map, legacy));

    // Write the encoded trie to disk
    fs.writeFileSync(
        `${__dirname}/../src/generated/decode-data-${name}.ts`,
        `// Generated using scripts/write-decode-map.ts
// prettier-ignore
export default new Uint16Array([${encoded
            .map((val) => val.toString(10))
            .join(",")}]);
`
    );
}

convertMapToBinaryTrie("xml", xmlMap, {});
convertMapToBinaryTrie("html", entityMap, legacyMap);

console.log("Done!");
