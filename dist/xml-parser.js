import { SaxesParser } from "saxes";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
export function createSaxesParserAdapter(handlers) {
    const parser = new SaxesParser({
        xmlns: true,
        defaultXMLVersion: "1.0",
    });
    parser.on("xmldecl", (declaration) => handlers.onXmlDeclaration(toDeclaration(declaration)));
    parser.on("error", handlers.onError);
    parser.on("opentag", (node) => handlers.onOpenElement(toElement(node)));
    parser.on("text", handlers.onText);
    parser.on("cdata", handlers.onCdata);
    parser.on("doctype", handlers.onDoctype);
    parser.on("closetag", handlers.onCloseElement);
    return {
        write(chunk) {
            parser.write(chunk);
        },
        close() {
            parser.close();
        },
        location() {
            return {
                line: parser.line,
                column: parser.column,
                position: parser.position,
            };
        },
    };
}
export function isSchemaUtilityAttribute(attribute) {
    return attribute.uri === XMLNS_NS
        || attribute.name === "xmlns"
        || attribute.name.startsWith("xmlns:")
        || attribute.uri === XSI_NS;
}
function toDeclaration(declaration) {
    return {
        version: declaration.version,
        encoding: declaration.encoding,
        standalone: declaration.standalone,
    };
}
function toElement(node) {
    return {
        name: node.name,
        local: node.local || node.name,
        uri: node.uri || "",
        attributes: toAttributes(node.attributes),
    };
}
function toAttributes(attributes) {
    const normalized = {};
    for (const [key, value] of Object.entries(attributes)) {
        normalized[key] = {
            name: value.name,
            local: value.local,
            value: value.value,
            uri: value.uri,
        };
    }
    return normalized;
}
