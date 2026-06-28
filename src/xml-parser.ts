import { SaxesParser } from "saxes";
import type { SaxesAttributeNS, SaxesTagNS, XMLDecl } from "saxes";

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

export function createSaxesParserAdapter(handlers: XmlParserHandlers): XmlParserAdapter {
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
    write(chunk: string): void {
      parser.write(chunk);
    },
    close(): void {
      parser.close();
    },
    location(): XmlParserLocation {
      return {
        line: parser.line,
        column: parser.column,
        position: parser.position,
      };
    },
  };
}

function toDeclaration(declaration: XMLDecl): XmlDeclaration {
  return {
    version: declaration.version,
    encoding: declaration.encoding,
    standalone: declaration.standalone,
  };
}

function toElement(node: SaxesTagNS): XmlElement {
  return {
    name: node.name,
    local: node.local || node.name,
    uri: node.uri || "",
    attributes: toAttributes(node.attributes),
  };
}

function toAttributes(attributes: Record<string, SaxesAttributeNS>): Record<string, XmlAttribute> {
  const normalized: Record<string, XmlAttribute> = {};

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
