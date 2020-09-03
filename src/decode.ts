import entityMap from "./maps/entities.json";
import legacyMap from "./maps/legacy.json";
import xmlMap from "./maps/xml.json";
import decodeCodePoint from "./decode_codepoint";

export const decodeXML = getStrictDecoder(xmlMap);
export const decodeHTMLStrict = getStrictDecoder(entityMap);

export interface MapType {
    [key: string]: string;
}

function getStrictDecoder(map: MapType) {
    let keys = Object.keys(map).join("|");
    const replace = getReplacer(map);

    keys += "|#[xX][\\da-fA-F]+|#\\d+";

    const re = new RegExp(`&(?:${keys});`, "g");

    return (str: string) => String(str).replace(re, replace);
}

const sorter = (a: string, b: string) => (a < b ? 1 : -1);

export const decodeHTML = (function () {
    const legacy = Object.keys(legacyMap).sort(sorter);
    const keys = Object.keys(entityMap).sort(sorter);

    for (let i = 0, j = 0; i < keys.length; i++) {
        if (legacy[j] === keys[i]) {
            keys[i] += ";?";
            j++;
        } else {
            keys[i] += ";";
        }
    }

    const re = new RegExp(
        `&(?:${keys.join("|")}|#[xX][\\da-fA-F]+;?|#\\d+;?)`,
        "g"
    );
    const replace = getReplacer(entityMap);

    function replacer(str: string): string {
        if (str.substr(-1) !== ";") str += ";";
        return replace(str);
    }

    // TODO consider creating a merged map
    return (str: string) => String(str).replace(re, replacer);
})();

function getReplacer(map: MapType) {
    return function replace(str: string): string {
        if (str.charAt(1) === "#") {
            const secondChar = str.charAt(2);
            if (secondChar === "X" || secondChar === "x") {
                return decodeCodePoint(parseInt(str.substr(3), 16));
            }
            return decodeCodePoint(parseInt(str.substr(2), 10));
        }
        return map[str.slice(1, -1)];
    };
}
