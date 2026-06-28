export interface XmlAttribute {
    name: string;
    local: string;
    value: string;
    uri: string;
}
export interface XmlElement {
    name: string;
    local: string;
    uri: string;
    attributes: Record<string, XmlAttribute>;
}
export interface XmlParserLocation {
    line: number;
    column: number;
    position: number;
}
export interface XmlDeclaration {
    version?: string | undefined;
    encoding?: string | undefined;
    standalone?: string | undefined;
}
export interface XmlParserAdapter {
    write(chunk: string): void;
    close(): void;
    location(): XmlParserLocation;
}
export interface XmlParserHandlers {
    onXmlDeclaration(declaration: XmlDeclaration): void;
    onOpenElement(element: XmlElement): void;
    onText(text: string): void;
    onCdata(text: string): void;
    onDoctype(): void;
    onCloseElement(): void;
    onError(error: Error): void;
}
export declare function createSaxesParserAdapter(handlers: XmlParserHandlers): XmlParserAdapter;
