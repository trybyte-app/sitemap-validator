import { SaxesParser } from "saxes";
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
