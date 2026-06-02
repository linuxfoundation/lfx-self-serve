// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import sanitizeHtml from 'sanitize-html';

import { createMarked } from './marked-config.mjs';
import { sanitizeDocsHtml } from './sanitize.mjs';

const MANIFEST_SCHEMA_VERSION = 1;

/**
 * Canonical topic display order. Mirrors `DOCS_TAXONOMY_ORDER` exported from
 * `@lfx-one/shared` (packages/shared/src/constants/docs.constant.ts) — the
 * shared module is the runtime source of truth for the Angular app, but this
 * build script is a Node-only `.mjs` and Node 24's strict ESM resolver
 * rejects directory imports in the shared package's existing dist. Keeping a
 * local copy avoids forcing a shared-package rebuild on every `docs:build`
 * and means the script has zero dependency on the workspace's TypeScript
 * compile state. Update both lists when adding a new topic; the docs build
 * coverage check (T051) catches drift between the markdown source tree and
 * the manifest.
 */
const DOCS_TAXONOMY_ORDER = [
  'badges',
  'committees',
  'dashboards',
  'documents',
  'events',
  'mailing-lists',
  'meetings',
  'profile',
  'settings',
  'surveys',
  'trainings',
  'transactions',
  'votes',
];

/**
 * Builds the typed `DocsManifest` from a list of source records. Pure: given
 * the same input array (in the same order), it produces a byte-identical
 * manifest (research R17).
 *
 * Responsibilities:
 *   - Render each article's body (marked → link rewrite → sanitize).
 *   - Apply FR-028 front-matter fallbacks (title from first H1; description
 *     from the first non-heading paragraph, ≤160 chars).
 *   - Derive `breadcrumb`, `siblings`, `isTopicLanding`.
 *   - Synthesize the root `/docs` landing if no explicit root article exists.
 *   - Build `topics` in `DOCS_TAXONOMY_ORDER`, appending unknown topics
 *     alphabetically (so a new topic doesn't break the build).
 *   - Compute `contentHash` (SHA-256 over sorted body content).
 *
 * @param {{ records: import('./walk-source.mjs').SourceRecord[] }} args
 * @returns {{ manifest: import('@lfx-one/shared').DocsManifest, warnings: string[] }}
 */
export function buildDocsManifest({ records }) {
  /** @type {string[]} */
  const warnings = [];

  // 1. Build the source-path → slug map up front so the link rewriter can run
  //    against it during marked rendering.
  /** @type {Record<string, string>} */
  const sourcePathToSlug = {};
  for (const record of records) {
    sourcePathToSlug[record.sourcePath] = record.slug;
  }

  // 2. Render each article body and capture headings.
  /** @type {Map<string, import('@lfx-one/shared').DocsArticle>} */
  const partialArticles = new Map();
  for (const record of records) {
    /** @type {{ slug: string, sourcePath: string, topic: string }} */
    const articleStub = {
      slug: record.slug,
      sourcePath: record.sourcePath,
      topic: deriveTopic(record.slug),
    };
    /** @type {import('./marked-config.mjs').BuildContext} */
    const ctx = {
      article: articleStub,
      sourcePathToSlug,
      warnings,
      headings: [],
    };
    const marked = createMarked(ctx);
    const rawHtml = marked.parse(record.body);
    const bodyHtml = sanitizeDocsHtml(typeof rawHtml === 'string' ? rawHtml : '');
    const bodyText = htmlToPlainText(bodyHtml);

    // FR-028 front-matter fallbacks.
    const fmTitle = stringField(record.frontMatter, 'title');
    const fmDescription = stringField(record.frontMatter, 'description');
    const titleFromHeading = ctx.headings.find((h) => h.level === 1)?.text ?? '';
    const titleFromSlug = titleCaseSlug(record.slug);
    const title = fmTitle || titleFromHeading || titleFromSlug || 'Documentation';

    const description = fmDescription || derivedDescription(bodyText);

    if (!fmTitle && !titleFromHeading) {
      warnings.push(`${record.sourcePath}: title fallback used (slug-derived)`);
    }
    if (!fmDescription) {
      warnings.push(`${record.sourcePath}: description derived from body`);
    }

    const lastUpdated = stringField(record.frontMatter, 'last_updated') || record.mtimeIso;
    const audience = arrayField(record.frontMatter, 'audience');
    const tags = arrayField(record.frontMatter, 'tags');
    const productArea = stringField(record.frontMatter, 'product_area');
    const intercomCollection = stringField(record.frontMatter, 'intercom_collection');
    const displayOrderRaw = record.frontMatter['display_order'];
    const displayOrder = typeof displayOrderRaw === 'number' ? displayOrderRaw : undefined;

    const article = /** @type {import('@lfx-one/shared').DocsArticle} */ ({
      slug: record.slug,
      url: record.slug === '' ? '/docs' : `/docs/${record.slug}`,
      sourcePath: record.sourcePath,
      topic: articleStub.topic,
      title,
      description,
      bodyHtml,
      headings: ctx.headings,
      bodyText,
      audience: audience.length > 0 ? /** @type {import('@lfx-one/shared').DocsAudience[]} */ (audience) : undefined,
      productArea: productArea || undefined,
      tags: tags.length > 0 ? tags : undefined,
      intercomCollection: intercomCollection || undefined,
      lastUpdated,
      breadcrumb: [],
      siblings: [],
      isTopicLanding: isTopicLanding(record.slug),
      displayOrder,
    });

    partialArticles.set(article.slug, article);
    for (const w of record.warnings) warnings.push(w);
  }

  // 3. Synthesize the root /docs landing if no explicit root article exists.
  if (!partialArticles.has('')) {
    // Use the latest source mtime as the synthetic root's lastUpdated so the
    // manifest stays byte-identical across runs (R17). The walk-source loop
    // hasn't yet computed the latest mtime, so derive it inline.
    let latestSyntheticMtimeMs = 0;
    for (const r of records) {
      if (r.mtimeMs > latestSyntheticMtimeMs) latestSyntheticMtimeMs = r.mtimeMs;
    }
    const syntheticLastUpdated = (latestSyntheticMtimeMs ? new Date(latestSyntheticMtimeMs) : new Date(Date.UTC(1970, 0, 1))).toISOString().slice(0, 10);
    const synthetic = /** @type {import('@lfx-one/shared').DocsArticle} */ ({
      slug: '',
      url: '/docs',
      sourcePath: '',
      topic: '',
      title: 'LFX Self Serve Documentation',
      description: 'Browse user guides for the LFX Self Serve product.',
      bodyHtml: '',
      headings: [],
      bodyText: '',
      lastUpdated: syntheticLastUpdated,
      breadcrumb: [],
      siblings: [],
      isTopicLanding: false,
      audience: undefined,
      productArea: undefined,
      tags: undefined,
      intercomCollection: undefined,
      displayOrder: undefined,
    });
    partialArticles.set('', synthetic);
  }

  // 4. Compute breadcrumbs and siblings now that the full inventory is known.
  for (const article of partialArticles.values()) {
    article.breadcrumb = computeBreadcrumb(article.slug, partialArticles);
  }
  for (const article of partialArticles.values()) {
    article.siblings = computeSiblings(article, partialArticles);
  }

  // 5. Build topics in canonical display order.
  /** @type {Map<string, string[]>} */
  const topicArticleSlugs = new Map();
  for (const article of partialArticles.values()) {
    if (article.slug === '') continue;
    const list = topicArticleSlugs.get(article.topic) ?? [];
    list.push(article.slug);
    topicArticleSlugs.set(article.topic, list);
  }
  const topicOrder = orderedTopics([...topicArticleSlugs.keys()]);
  /** @type {import('@lfx-one/shared').DocsTopic[]} */
  const topics = topicOrder.map((slug, index) => {
    const landing = partialArticles.get(slug);
    const slugs = topicArticleSlugs.get(slug) ?? [];
    slugs.sort((a, b) => sortByDisplayOrderThenAlpha(partialArticles.get(a), partialArticles.get(b)));
    return {
      slug,
      name: landing?.title ?? titleCaseSlug(slug),
      description: landing?.description ?? '',
      displayOrder: index,
      landingSlug: slug,
      articleSlugs: slugs,
    };
  });

  // 6. Build the recursive taxonomy tree.
  const tree = buildTaxonomyTree(partialArticles, topics);

  // 7. Compute the content hash for change detection.
  const hash = createHash('sha256');
  for (const record of records) {
    hash.update(record.sourcePath);
    hash.update('\u0000');
    hash.update(record.body);
    hash.update('\u0000');
  }
  const contentHash = hash.digest('hex');

  /** @type {Record<string, import('@lfx-one/shared').DocsArticle>} */
  const articles = {};
  // Insert in slug-sorted order for stable JSON output.
  for (const slug of [...partialArticles.keys()].sort()) {
    const a = partialArticles.get(slug);
    if (a) articles[slug] = a;
  }

  // generatedAt: ISO-8601 timestamp of the most-recently-modified source file.
  // R17 idempotence requires byte-identical output for identical input, so we
  // CAN'T use Date.now() — that drifts between runs. Source mtime is both
  // deterministic and semantically truthful: "the docs were last updated
  // when the latest source file was touched."
  let latestMtimeMs = 0;
  for (const r of records) {
    if (r.mtimeMs > latestMtimeMs) latestMtimeMs = r.mtimeMs;
  }
  const generatedAt = new Date(latestMtimeMs || Date.UTC(1970, 0, 1)).toISOString();

  /** @type {import('@lfx-one/shared').DocsManifest} */
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt,
    contentHash,
    topics,
    articles,
    tree,
    sourcePathToSlug,
  };

  return { manifest, warnings };
}

/**
 * Builds the recursive taxonomy tree under the synthetic root.
 *
 * @param {Map<string, import('@lfx-one/shared').DocsArticle>} articles
 * @param {import('@lfx-one/shared').DocsTopic[]} topics
 * @returns {import('@lfx-one/shared').DocsTaxonomyNode}
 */
function buildTaxonomyTree(articles, topics) {
  const root = articles.get('');
  /** @type {import('@lfx-one/shared').DocsTaxonomyNode} */
  const tree = {
    slug: '',
    title: root?.title ?? 'LFX Self Serve Documentation',
    url: '/docs',
    children: [],
  };

  for (const topic of topics) {
    const topicArticle = articles.get(topic.slug);
    if (!topicArticle) continue;
    /** @type {import('@lfx-one/shared').DocsTaxonomyNode} */
    const topicNode = {
      slug: topicArticle.slug,
      title: topicArticle.title,
      url: topicArticle.url,
      children: [],
    };

    for (const childSlug of topic.articleSlugs) {
      if (childSlug === topic.slug) continue;
      const child = articles.get(childSlug);
      if (!child) continue;
      topicNode.children.push({
        slug: child.slug,
        title: child.title,
        url: child.url,
        children: [],
      });
    }

    tree.children.push(topicNode);
  }
  return tree;
}

/**
 * @param {string} slug
 * @param {Map<string, import('@lfx-one/shared').DocsArticle>} articles
 * @returns {import('@lfx-one/shared').DocsBreadcrumbItem[]}
 */
function computeBreadcrumb(slug, articles) {
  /** @type {import('@lfx-one/shared').DocsBreadcrumbItem[]} */
  const trail = [];
  const root = articles.get('');
  if (root) trail.push({ slug: '', title: root.title, url: '/docs' });
  if (slug === '') return trail;

  const segments = slug.split('/');
  let prefix = '';
  for (const seg of segments) {
    prefix = prefix === '' ? seg : `${prefix}/${seg}`;
    const article = articles.get(prefix);
    if (article) {
      trail.push({ slug: article.slug, title: article.title, url: article.url });
    }
  }
  return trail;
}

/**
 * Sibling slugs in the same topic, excluding `article` itself, sorted by
 * `displayOrder` then alphabetically.
 *
 * @param {import('@lfx-one/shared').DocsArticle} article
 * @param {Map<string, import('@lfx-one/shared').DocsArticle>} articles
 * @returns {string[]}
 */
function computeSiblings(article, articles) {
  if (article.slug === '' || article.topic === '') return [];
  /** @type {import('@lfx-one/shared').DocsArticle[]} */
  const peers = [];
  for (const a of articles.values()) {
    if (a.slug === '' || a.slug === article.slug) continue;
    // Exclude the topic landing from leaf-article sibling lists — the
    // breadcrumb already surfaces it, and "More in this topic" should
    // surface peer how-to articles, not the parent overview page.
    if (a.isTopicLanding && !article.isTopicLanding) continue;
    if (a.topic === article.topic) peers.push(a);
  }
  peers.sort(sortByDisplayOrderThenAlpha);
  return peers.map((p) => p.slug);
}

/**
 * @param {import('@lfx-one/shared').DocsArticle | undefined} a
 * @param {import('@lfx-one/shared').DocsArticle | undefined} b
 */
function sortByDisplayOrderThenAlpha(a, b) {
  if (!a || !b) return 0;
  const aOrder = typeof a.displayOrder === 'number' ? a.displayOrder : Number.POSITIVE_INFINITY;
  const bOrder = typeof b.displayOrder === 'number' ? b.displayOrder : Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * @param {string[]} foundTopicSlugs
 * @returns {string[]}
 */
function orderedTopics(foundTopicSlugs) {
  const found = new Set(foundTopicSlugs);
  const ordered = [];
  for (const topic of DOCS_TAXONOMY_ORDER) {
    if (found.has(topic)) {
      ordered.push(topic);
      found.delete(topic);
    }
  }
  // Append any topics not in the canonical order (alphabetical).
  return ordered.concat([...found].sort());
}

/** @param {string} slug */
function deriveTopic(slug) {
  if (slug === '') return '';
  const idx = slug.indexOf('/');
  return idx === -1 ? slug : slug.slice(0, idx);
}

/** @param {string} slug */
function isTopicLanding(slug) {
  if (slug === '') return false;
  return !slug.includes('/');
}

/**
 * @param {Record<string, unknown>} fm
 * @param {string} key
 * @returns {string}
 */
function stringField(fm, key) {
  const v = fm[key];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * @param {Record<string, unknown>} fm
 * @param {string} key
 * @returns {string[]}
 */
function arrayField(fm, key) {
  const v = fm[key];
  if (Array.isArray(v)) {
    return v.filter((x) => typeof x === 'string').map((x) => /** @type {string} */ (x).trim());
  }
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** @param {string} slug */
function titleCaseSlug(slug) {
  if (!slug) return '';
  const last = slug.split('/').pop() ?? '';
  return last
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Strips HTML tags and decodes HTML entities to produce plain text suitable
 * for description / search-body derivation. Not a security boundary — the
 * input is already sanitized by the time this runs — but we use
 * `sanitize-html` (a real HTML parser) instead of a regex chain so we don't
 * fall foul of CodeQL's "incomplete multi-character sanitization" /
 * "double escaping or unescaping" patterns. Block-level closing tags are
 * pre-replaced with newlines so paragraph structure survives the strip,
 * which preserves snippet readability for the search index.
 *
 * @param {string} html
 */
function htmlToPlainText(html) {
  // Pre-tag block-level boundaries with newlines so the resulting plain text
  // preserves paragraph structure for descriptions / search snippets. The
  // pattern matches closing tags only (`</...>`) — a literal `<` cannot
  // match here, so it is not the kind of regex CodeQL flags as incomplete
  // sanitization (the flagged class is `<[^>]+>`-style strippers).
  const withNewlines = html
    .replace(/<\/(?:p|h[1-6]|li|tr|blockquote|figure|figcaption|hr)>/gi, '$&\n')
    .replace(/<br\s*\/?>/gi, '\n');
  // sanitize-html parses the HTML with a real parser, strips every tag,
  // and decodes named entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
  // numeric refs) safely — no manual unescape chain that could be
  // mis-iterated.
  const stripped = sanitizeHtml(withNewlines, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
  return stripped
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * FR-028 description fallback: first paragraph of the body, capped at ~160
 * characters on a word boundary.
 *
 * @param {string} bodyText
 */
function derivedDescription(bodyText) {
  if (!bodyText) return '';
  const firstPara = bodyText.split(/\n{2,}/)[0]?.replace(/\n/g, ' ').trim() ?? '';
  if (firstPara.length <= 160) return firstPara;
  const truncated = firstPara.slice(0, 160);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 100 ? truncated.slice(0, lastSpace) : truncated) + '…';
}
