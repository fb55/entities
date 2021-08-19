import { decodeXML, decodeHTML, decodeHTMLStrict } from "./decode";
import {
    encodeXML,
    escapeUTF8,
    encodeHTML,
    encodeNonAsciiHTML,
} from "./encode";

/** The level of entities to support. */
export enum EntityLevel {
    /** Support only XML entities. */
    XML = 0,
    /** Support HTML entities, which are a superset of XML entities. */
    HTML = 1,
}

/** Determines whether some entities are allowed to be written without a trailing `;`. */
export enum DecodingMode {
    /** Support legacy HTML entities. */
    Legacy = 0,
    /** Do not support legacy HTML entities. */
    Strict = 1,
}

export enum EncodingMode {
    /**
     * The output is UTF-8 encoded. Only characters that need escaping within
     * HTML will be escaped.
     */
    UTF8,
    /**
     * The output consists only of ASCII characters. Characters that need
     * escaping within HTML, and characters that aren't ASCII characters will
     * be escaped.
     */
    ASCII,
    /**
     * Encode all characters that have an equivalent entity, as well as all
     * characters that are not ASCII characters.
     */
    Extensive,
}

export interface DecodingOptions {
    /**
     * The level of entities to support.
     * @default {@link EntityLevel.XML}
     */
    level?: EntityLevel;
    /**
     * Decoding mode. If `Legacy`, will support legacy entities not terminated
     * with a semicolon (`;`).
     *
     * Always `Strict` for XML. For HTML, set this to `true` if you are parsing
     * an attribute value.
     *
     * The deprecated `decodeStrict` function defaults this to `Strict`.
     *
     * @default {@link DecodingMode.Legacy}
     */
    mode?: DecodingMode;
}

/**
 * Decodes a string with entities.
 *
 * @param data String to decode.
 * @param options Decoding options.
 */
export function decode(
    data: string,
    options: DecodingOptions | EntityLevel = EntityLevel.XML
): string {
    const opts = typeof options === "number" ? { level: options } : options;

    if (opts.level === EntityLevel.HTML) {
        if (opts.mode === DecodingMode.Strict) {
            return decodeHTMLStrict(data);
        }
        return decodeHTML(data);
    }

    return decodeXML(data);
}

/**
 * Decodes a string with entities. Does not allow missing trailing semicolons for entities.
 *
 * @param data String to decode.
 * @param options Decoding options.
 * @deprecated Use `decode` with the `mode` set to `Strict`.
 */
export function decodeStrict(
    data: string,
    options: DecodingOptions | EntityLevel = EntityLevel.XML
): string {
    const opts = typeof options === "number" ? { level: options } : options;

    if (opts.level === EntityLevel.HTML) {
        if (opts.mode === DecodingMode.Legacy) {
            return decodeHTML(data);
        }
        return decodeHTMLStrict(data);
    }

    return decodeXML(data);
}

/**
 * Options for `encode`.
 */
export interface EncodingOptions {
    /**
     * The level of entities to support.
     * @default {@link EntityLevel.XML}
     */
    level?: EntityLevel;
    /**
     * Output format.
     * @default {@link EncodingMode.Extensive}
     */
    mode?: EncodingMode;
}

/**
 * Encodes a string with entities.
 *
 * @param data String to encode.
 * @param options Encoding options.
 */
export function encode(
    data: string,
    options: EncodingOptions | EntityLevel = EntityLevel.XML
): string {
    const opts = typeof options === "number" ? { level: options } : options;

    // Mode `UTF8` just escapes XML entities
    if (opts.mode === EncodingMode.UTF8) return escapeUTF8(data);

    if (opts.level === EntityLevel.HTML) {
        if (opts.mode === EncodingMode.ASCII) {
            return encodeNonAsciiHTML(data);
        }

        return encodeHTML(data);
    }

    // ASCII and Extensive are equivalent
    return encodeXML(data);
}

export {
    encodeXML,
    encodeHTML,
    encodeNonAsciiHTML,
    escape,
    escapeUTF8,
    // Legacy aliases (deprecated)
    encodeHTML as encodeHTML4,
    encodeHTML as encodeHTML5,
} from "./encode";

export {
    decodeXML,
    decodeHTML,
    decodeHTMLStrict,
    // Legacy aliases (deprecated)
    decodeHTML as decodeHTML4,
    decodeHTML as decodeHTML5,
    decodeHTMLStrict as decodeHTML4Strict,
    decodeHTMLStrict as decodeHTML5Strict,
    decodeXML as decodeXMLStrict,
} from "./decode";
