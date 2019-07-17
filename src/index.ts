import { decodeXML, decodeHTML, decodeHTMLStrict } from "./decode";
import { encodeXML, encodeHTML } from "./encode";

export function decode(data: string, level?: number): string {
    return (!level || level <= 0 ? decodeXML : decodeHTML)(data);
}

export function decodeStrict(data: string, level?: number): string {
    return (!level || level <= 0 ? decodeXML : decodeHTMLStrict)(data);
}

export function encode(data: string, level?: number): string {
    return (!level || level <= 0 ? encodeXML : encodeHTML)(data);
}

export {
    encodeXML,
    encodeHTML,
    escape,
    // Legacy aliases
    encodeHTML as encodeHTML4,
    encodeHTML as encodeHTML5
} from "./encode";

export {
    decodeXML,
    decodeHTML,
    decodeHTMLStrict,
    // Legacy aliases
    decodeHTML as decodeHTML4,
    decodeHTML as decodeHTML5,
    decodeHTMLStrict as decodeHTML4Strict,
    decodeHTMLStrict as decodeHTML5Strict,
    decodeXML as decodeXMLStrict
} from "./decode";
