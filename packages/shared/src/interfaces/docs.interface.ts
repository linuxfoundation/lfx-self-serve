// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Audience tag a docs article applies to. Sourced from front-matter `audience`.
 * 'all' means every visitor; the persona-specific values match LFX's persona vocabulary.
 */
export type DocsAudience = 'all' | 'contributor' | 'maintainer' | 'board-member' | 'executive-director';

/**
 * One heading inside an article body. Used for in-article TOC, search index,
 * and aria landmark generation.
 */
export interface DocsHeading {
  /** Heading level: 1–6 (matching H1–H6). */
  level: number;
  /** Heading text content. */
  text: string;
  /** Slugified anchor id used as the in-article fragment (e.g. 'before-you-begin'). */
  id: string;
}

/**
 * One step in the breadcrumb trail to an article, denormalized so renderers
 * never need a second manifest lookup to build a breadcrumb.
 */
export interface DocsBreadcrumbItem {
  /** Slug of the article in this breadcrumb position. */
  slug: string;
  /** Title of that article (denormalized). */
  title: string;
  /** URL of that article (denormalized). */
  url: string;
}

/**
 * A single piece of help content, sourced from one markdown file under
 * `docs/user/`. Identified by its source path (e.g.
 * `docs/user/meetings/schedule-meeting/index.md`), surfaced at a corresponding
 * URL (e.g. `/docs/meetings/schedule-meeting`) that matches
 * `^/docs(?:/[a-z0-9-]+(?:/[a-z0-9-]+)*)?$`, and described by front-matter
 * fields. Produced at build time by `apps/lfx-one/scripts/build-docs.mjs`.
 */
export interface DocsArticle {
  /**
   * Stable identifier — derived from the source path with `docs/user/` and
   * trailing `/index.md` stripped. Empty string for the synthetic root landing.
   * Examples: '', 'meetings/schedule-meeting', 'votes', 'profile/edit-profile'.
   */
  slug: string;

  /**
   * Public URL path. Always starts with '/docs', never has a trailing slash.
   * Examples: '/docs', '/docs/meetings/schedule-meeting', '/docs/votes'.
   */
  url: string;

  /**
   * Source markdown file path, relative to repo root.
   * Example: 'docs/user/meetings/schedule-meeting/index.md'.
   */
  sourcePath: string;

  /**
   * Topic slug this article belongs to. Top-level topic articles have
   * `topic === slug`; the synthetic root landing has `topic === ''`.
   * Example: 'meetings'.
   */
  topic: string;

  /**
   * Human-readable title for the page <title>, breadcrumb, search results, and TOC.
   * Resolution order: front-matter `title` → first H1 in body → derived from slug.
   */
  title: string;

  /**
   * Short summary used for meta description, OpenGraph, and search snippet fallback.
   * Resolution order: front-matter `description` → first paragraph (≤160 chars) → derived.
   */
  description: string;

  /**
   * Sanitized HTML body, ready to bind via `[innerHTML]`. Cross-links have
   * already been rewritten to absolute `/docs/...` URLs at build time.
   */
  bodyHtml: string;

  /**
   * Outline of headings (H1–H6) in the body, in document order. Used for
   * in-article TOC, search index, and ARIA landmarks.
   */
  headings: DocsHeading[];

  /** Plain-text body (HTML stripped) used by the search indexer and description fallback. */
  bodyText: string;

  /** Front-matter `audience` field. */
  audience?: DocsAudience[];

  /** Front-matter `product_area` field. */
  productArea?: string;

  /** Front-matter `tags` field. */
  tags?: string[];

  /** Front-matter `intercom_collection` field — Intercom Help Center collection mapping. */
  intercomCollection?: string;

  /**
   * Last-updated date (ISO-8601 `yyyy-mm-dd`). Resolved from front-matter
   * `last_updated`, falling back to file mtime at build time.
   */
  lastUpdated: string;

  /** Breadcrumb trail to this article, ordered from root to leaf (inclusive). */
  breadcrumb: DocsBreadcrumbItem[];

  /**
   * Sibling article slugs in the same topic, ordered by `displayOrder` then
   * alphabetical. Excludes this article itself.
   */
  siblings: string[];

  /** Whether this article is the topic's landing page (`<topic>/index.md`). */
  isTopicLanding: boolean;

  /**
   * Display order within siblings — sourced from front-matter `display_order`
   * if present, otherwise alphabetical by slug.
   */
  displayOrder?: number;
}

/**
 * A grouping of related articles, corresponding to a top-level subdirectory
 * of `docs/user/`. The display order is determined by the docs build
 * pipeline using the canonical list in `DOCS_TAXONOMY_ORDER` (shared
 * constants); the constant and the build script keep synchronized copies
 * for ESM-resolution reasons (see `DOCS_TAXONOMY_ORDER`'s JSDoc) and
 * `docs:check-coverage` catches drift.
 */
export interface DocsTopic {
  /** Topic slug — equal to the top-level subdirectory name. Example: 'meetings'. */
  slug: string;

  /**
   * Display name for landing-page tiles, breadcrumbs, and navigation. Title-cased.
   * Resolution: from `<topic>/index.md` front-matter `title`, falling back to slug → title-case.
   */
  name: string;

  /**
   * Topic-level summary for the landing-page tile. From `<topic>/index.md`
   * front-matter `description`, falling back to a derived summary.
   */
  description: string;

  /**
   * Display order on the landing page. Assigned by the docs build pipeline
   * from each topic's index in `DOCS_TAXONOMY_ORDER` (shared constants);
   * topics outside that list are appended alphabetically. Consumers should
   * read this field directly rather than recomputing from the constant at
   * runtime.
   */
  displayOrder: number;

  /** Optional FontAwesome icon class for the topic tile. */
  icon?: string;

  /** Slug of the topic's landing article. Always equals `slug`. */
  landingSlug: string;

  /** Slugs of every article belonging to this topic (including the landing), in display order. */
  articleSlugs: string[];
}

/**
 * Recursive tree representation of the taxonomy under `/docs`. Used by the
 * landing page, breadcrumbs, and any future sidebar TOC. The root node is
 * synthetic (slug `''`) and represents `/docs` itself.
 */
export interface DocsTaxonomyNode {
  /** Slug of this node's article (or `''` for the synthetic root). */
  slug: string;
  /** Title — denormalized from the matching `DocsArticle` for cheap traversal. */
  title: string;
  /** URL — denormalized. */
  url: string;
  /** Children, in display order. */
  children: DocsTaxonomyNode[];
}

/**
 * Top-level build artifact emitted by `apps/lfx-one/scripts/build-docs.mjs`.
 * Imported synchronously by `DocsManifestService` so SSR can resolve any
 * `/docs/**` path without async I/O.
 */
export interface DocsManifest {
  /**
   * Schema version — bumped when the manifest shape changes incompatibly.
   * Runtime checks this and refuses to load on mismatch.
   */
  schemaVersion: number;

  /** ISO-8601 timestamp when this manifest was generated. */
  generatedAt: string;

  /**
   * SHA-256 of the concatenated source markdown files, used as a fast
   * change-detection signal in CI.
   */
  contentHash: string;

  /** Topics in canonical display order. */
  topics: DocsTopic[];

  /**
   * Flat lookup table: slug → article. Includes EVERY article including the
   * synthetic root landing (slug `''`).
   */
  articles: Record<string, DocsArticle>;

  /** Recursive taxonomy tree, root is slug `''`. */
  tree: DocsTaxonomyNode;

  /** Lookup table: source path → slug, used by build-time link rewriting and CI checks. */
  sourcePathToSlug: Record<string, string>;
}

/**
 * One per-article document indexed by MiniSearch. Ranking weights live with
 * the build script (R5): title 3×, headings 2×, tags 2×, body 1×.
 */
export interface DocsSearchEntry {
  /** MiniSearch document id — equal to the article slug. */
  id: string;
  /** Article title — boosted 3× in search ranking. */
  title: string;
  /** Joined heading text (H1–H4) — boosted 2×. */
  headings: string;
  /** Plain-text body — 1× weight. */
  body: string;
  /** Joined tags — boosted 2×. */
  tags: string;
  /** Article URL — included as a stored field, not indexed for search. */
  url: string;
  /** Topic slug — included as a stored field for filtering / facet display. */
  topic: string;
}

/**
 * One row in a search-results panel — the runtime view of a `DocsSearchEntry`
 * after `MiniSearch.search()` has scored it and the runtime has computed a
 * snippet around the matched terms.
 */
export interface DocsSearchHit {
  /** Article slug — also the MiniSearch document id. */
  id: string;
  /** Article URL. */
  url: string;
  /** Article title. */
  title: string;
  /** Topic slug. */
  topic: string;
  /** Plain-text snippet around the matched terms. */
  snippet: string;
  /** Search-engine relevance score (`MiniSearch.search()` output). */
  score: number;
}

/**
 * Serialized search-index payload shipped at `/assets/docs/search-index.json`.
 * The `miniSearch` field is the result of `MiniSearch.toJSON()`; the runtime
 * service calls `MiniSearch.loadJSON()` to revive it.
 */
export interface DocsSearchIndexFile {
  /**
   * Schema version of the search-index payload — separate from the manifest's
   * `schemaVersion` so the two artifacts can evolve independently.
   */
  schemaVersion: number;

  /** ISO-8601 generation timestamp. */
  generatedAt: string;

  /**
   * MiniSearch's native serialized form. Loaded via `MiniSearch.loadJSON()` at runtime.
   * Typed as `unknown` because MiniSearch's internal shape is not part of our contract.
   */
  miniSearch: unknown;

  /**
   * Original entries kept alongside the index for snippet generation post-match
   * (MiniSearch returns IDs only by default; the runtime looks up the entry to render snippets).
   */
  entries: Record<string, DocsSearchEntry>;
}
