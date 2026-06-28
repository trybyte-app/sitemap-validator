# Standards Coverage

This project validates generated XML sitemap documents against sitemaps.org,
Google Search Central XML sitemap guidance, and Google extension schemas where
those sources define document-level behavior.

## Covered Core Sitemap Rules

- XML well-formedness, XML 1.0, UTF-8 input, non-UTF-8 declaration diagnostics,
  and blocked DOCTYPE declarations.
- `urlset` and `sitemapindex` roots in the sitemap namespace.
- Required `url`, `sitemap`, and `loc` entries.
- Sitemap XSD child order and duplicate core child elements.
- Present optional fields must be non-empty and valid.
- `lastmod` accepts complete W3C date (`YYYY-MM-DD`) and datetime values; reduced
  precision values such as `YYYY` and `YYYY-MM` are rejected because sitemap
  schemas narrow `lastmod` to `xsd:date` or `xsd:dateTime`.
- `changefreq` allowed values and `priority` numeric range.
- `loc` minimum and maximum length.
- URL count, sitemap index count, and uncompressed byte limits.
- URL syntax checks layered across RFC 3986, RFC 3987, WHATWG URL behavior, and
  sitemap protocol constraints.
- Single-host document checks even when `sitemapLocation` is not supplied.
- Same protocol, host, and path-prefix constraints when `sitemapLocation` is
  supplied.
- Unknown custom namespace elements are allowed under `url`; if they appear
  before required core fields, the validator reports schema-order diagnostics.
- Unexpected attributes on sitemap protocol elements are rejected, while namespace
  declarations and XML Schema instance utility attributes are allowed.

## Covered Google Extension Rules

- Image sitemap placement, required `image:image` and `image:loc`, image count
  limit, schema child order, duplicate child constraints, deprecated fields,
  unknown fields, unexpected attributes, and URL validation for schema-backed URL
  fields.
- News sitemap placement, one news entry per URL, news entry count limit,
  required publication/name/language/date/title fields, stale publication date
  warnings, ISO language code checks, legacy XSD fields, schema order, duplicates,
  deprecated fields, unknown fields, and unexpected attributes.
- Video sitemap placement, required thumbnail/title/description and content or
  player location, direct media URL checks, supported media URL schemes, schema
  order, duplicates, typed scalar fields, title/description/category limits,
  integer-duration lexical checks, datetime precision checks, country and
  platform values, uploader info URL/domain, legacy XSD fields, deprecated
  fields, unknown fields, and unexpected attributes.
- PageMap sitemap extension placement, schema child order, singleton Template,
  required Template/DataObject/Attribute attributes, Attribute text-vs-value
  constraints, unknown fields, and unexpected attributes.
- Hreflang sitemap annotations with `xhtml:link`, `rel="alternate"`, required
  `hreflang` and `href`, BCP 47 parsing, Google-supported ISO 639 language,
  pinned ISO 15924 script, ISO 3166 region checks, self references, duplicate
  hreflang values within an entry, optional set-level return-link and cluster
  consistency checks, and unexpected attributes.
- Combined sitemap extensions in one URL entry.

## Intentional Boundaries

- Plain text, RSS, and Atom sitemap formats are out of scope; this package is
  XML-first.
- The validator does not fetch live sitemap URLs in the CLI publish gate.
- The validator does not fetch page URLs, image URLs, or video URLs.
- HTTP status, redirect, canonical, `noindex`, rendered metadata, and page
  content checks are out of scope.
- Robots.txt discovery and allow/disallow comparison are out of scope.
- Duplicate URL auditing across one or more sitemap files is out of scope.
- Empty Google News sitemaps are treated as protocol/XSD invalid because
  sitemaps.org requires at least one `url` entry. Google may tolerate an empty
  News sitemap operationally, but this validator keeps the stricter document-level
  protocol diagnostic.

## Source References

- [Sitemaps.org protocol](https://www.sitemaps.org/protocol.html)
- [Sitemap 0.9 XSD](https://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd)
- [Sitemap index XSD](https://www.sitemaps.org/schemas/sitemap/0.9/siteindex.xsd)
- [Google sitemap overview](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)
- [Google build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google large sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps)
- [Google image sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps)
- [Google News sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap)
- [Google video sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps)
- [Google combined sitemap extensions](https://developers.google.com/search/docs/crawling-indexing/sitemaps/combine-sitemap-extensions)
- [Google localized versions and hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Google image sitemap XSD](https://www.google.com/schemas/sitemap-image/1.1/sitemap-image.xsd)
- [Google News sitemap XSD](https://www.google.com/schemas/sitemap-news/0.9/sitemap-news.xsd)
- [Google video sitemap XSD](https://www.google.com/schemas/sitemap-video/1.1/sitemap-video.xsd)
- [Google PageMap sitemap XSD](https://www.google.com/schemas/sitemap-pagemap/1.0/sitemap-pagemap.xsd)
- [ISO 639-3 Registration Authority code table](https://iso639-3.sil.org/sites/iso639-3/files/downloads/iso-639-3.tab)
- [ISO 15924 script code registry](https://unicode.org/iso15924/iso15924.txt)

Run `npm run docs:rules` after changing rule definitions. The generated
[rule matrix](rule-matrix.md) is the implementation-backed list of current rule
codes, severities, sources, and spec links.
