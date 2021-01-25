import { decodeXML, decodeHTML, decodeHTMLStrict } from "./decode";
import { encodeXML, encodeHTML } from "./encode";

/**
 * Decodes a string with entities.
 *
 * @param data String to decode.
 * @param level Optional level to decode at. 0 = XML, 1 = HTML. Default is 0.
 */
export function decode(data: string, level?: number): string {
    return (!level || level <= 0 ? decodeXML : decodeHTML)(data);
}

/**
 * Decodes a string with entities. Does not allow missing trailing semicolons for entities.
 *
 * @param data String to decode.
 * @param level Optional level to decode at. 0 = XML, 1 = HTML. Default is 0.
 */
export function decodeStrict(data: string, level?: number): string {
    return (!level || level <= 0 ? decodeXML : decodeHTMLStrict)(data);
}

/**
 * Encodes a string with entities.
 *
 * @param data String to encode.
 * @param level Optional level to encode at. 0 = XML, 1 = HTML. Default is 0.
 */
export function encode(data: string, level?: number): string {
    return (!level || level <= 0 ? encodeXML : encodeHTML)(data);
}

export {
    encodeXML,
    encodeHTML,
    encodeNonAsciiHTML,
    escape,
    // Legacy aliases
    encodeHTML as encodeHTML4,
    encodeHTML as encodeHTML5,
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
    decodeXML as decodeXMLStrict,
} from "./decode";
