// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { posix } from 'node:path';

import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/**
 * @typedef {Object} BuildContext
 * @property {{ slug: string, sourcePath: string, topic: string }} article  Article being rendered.
 * @property {Record<string, string>} sourcePathToSlug  Source path → slug, for the link rewriter.
 * @property {string[]} warnings  Build warnings accumulated during rendering.
 * @property {{ level: number, text: string, id: string }[]} headings  Captured during rendering.
 * @property {Map<string, number>} [seenHeadingIds]  Per-article counter for duplicate
 *   slugs, used by `heading()` to suffix collisions. Optional in the typedef so call
 *   sites can leave it unset; the renderer initializes a fresh map on first use.
 */

/**
 * Builds a fresh `marked` instance configured with:
 *   - cross-link rewriting (research R11):
 *       * relative paths → `/docs/...` URL via `sourcePathToSlug`
 *       * absolute URLs left as-is and tagged `target=_blank rel=noopener`
 *       * `mailto:` and `tel:` left as-is
 *       * same-page anchors left as-is
 *   - heading capture for the article TOC (and search-index "headings" field)
 *   - heading anchor ids derived from heading text
 *
 * A new instance is returned per-call so the heading-capture closure is
 * scoped to a single article. The previous (shared) approach risked leaking
 * one article's headings into another's render.
 *
 * @param {BuildContext} ctx
 * @returns {Marked}
 */
export function createMarked(ctx) {
  const marked = new Marked({ gfm: true });

  marked.use({
    renderer: {
      link(rawTokenOrHref, rawTitle, rawText) {
        // marked v17 passes `{ href, title, tokens, text }` as the first arg
        // (object form). We support both legacy and object forms so the
        // helper works against any minor revision of marked v17.x. The
        // rendered visible content always comes from `parseInline(tokens)`
        // — `tokens.text` is the **raw markdown** label (e.g.
        // `"**Bold** label"`) and would emit literal asterisks if used as
        // the rendered output.
        let href;
        let title;
        let renderedText;
        if (typeof rawTokenOrHref === 'object' && rawTokenOrHref !== null) {
          href = rawTokenOrHref.href;
          title = rawTokenOrHref.title ?? null;
          renderedText = this.parser.parseInline(rawTokenOrHref.tokens ?? []);
        } else {
          href = rawTokenOrHref;
          title = rawTitle ?? null;
          renderedText = rawText ?? '';
        }

        const rewritten = rewriteHref(href ?? '', ctx);
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
        // External = any absolute (schema-qualified) URL. Relative paths
        // are already rewritten to `/docs/<slug>`-shaped internal URLs by
        // `rewriteHref` and same-page anchors short-circuit there too, so
        // an absolute scheme reaching this point is, by construction, a
        // link out to a different host or protocol.
        const isExternal = isAbsoluteUrl(rewritten);
        const externalAttrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escapeAttr(rewritten)}"${titleAttr}${externalAttrs}>${renderedText}</a>`;
      },

      heading(rawTokenOrText, rawDepth) {
        // marked v17: heading receives `{ text, depth, tokens }`; older
        // signatures pass (text, depth) positionally. Normalize to a uniform
        // shape, then derive two distinct strings: `plainText` for the
        // slug id (and TOC capture) and `renderedText` for the emitted
        // HTML. `tokens.text` is the **raw markdown** source for the
        // heading (e.g. `"Configure the **API** key"`), so using it
        // directly for output would render literal asterisks; the visible
        // text must come from `parseInline(tokens)`.
        let plainText;
        let renderedText;
        let depth;
        if (typeof rawTokenOrText === 'object' && rawTokenOrText !== null) {
          plainText = stripHtml(String(rawTokenOrText.text ?? ''));
          renderedText = this.parser.parseInline(rawTokenOrText.tokens ?? []);
          depth = rawTokenOrText.depth ?? rawDepth ?? 1;
        } else {
          plainText = stripHtml(String(rawTokenOrText));
          renderedText = String(rawTokenOrText);
          depth = rawDepth ?? 1;
        }
        const id = uniqueHeadingId(slugify(plainText), ctx);
        ctx.headings.push({ level: Number(depth), text: plainText, id });
        return `<h${depth} id="${escapeAttr(id)}">${renderedText}</h${depth}>`;
      },

      image(rawTokenOrHref, rawTitle, rawText) {
        let href;
        let title;
        let text;
        if (typeof rawTokenOrHref === 'object' && rawTokenOrHref !== null) {
          href = rawTokenOrHref.href;
          title = rawTokenOrHref.title ?? null;
          text = rawTokenOrHref.text ?? '';
        } else {
          href = rawTokenOrHref;
          title = rawTitle ?? null;
          text = rawText ?? '';
        }
        const safeHref = rewriteImageSrc(href ?? '', ctx);
        const altAttr = ` alt="${escapeAttr(text || '')}"`;
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
        return `<img src="${escapeAttr(safeHref)}"${altAttr}${titleAttr}>`;
      },
    },
  });

  return marked;
}

/**
 * Rewrites a markdown `[label](href)` to its final `<a href="...">`.
 *
 * Rules (research R11):
 *   - Same-page anchors (`#fragment`)             → unchanged.
 *   - Absolute URLs (`https://...`, `http://...`) → unchanged.
 *   - `mailto:` / `tel:`                          → unchanged.
 *   - Relative paths to other source files        → resolved against the
 *     article's source path, then mapped via `sourcePathToSlug` to a `/docs/`
 *     URL. Trailing `/index.md` and `.md` are stripped from the resolved path
 *     before the lookup so authors can write `[X](../foo/)`, `[X](../foo)`, or
 *     `[X](../foo/index.md)` interchangeably.
 *
 * Unresolvable relative links emit a warning into `ctx.warnings` and fall
 * back to the original `href` — the validator (T021a / T051) catches these as
 * build errors so the failure is centralized.
 *
 * @param {string} href
 * @param {BuildContext} ctx
 * @returns {string}
 */
export function rewriteHref(href, ctx) {
  if (!href) return '';
  if (href.startsWith('#')) return href;
  if (/^[a-z][a-z0-9+\-.]*:/i.test(href)) {
    // Schema-qualified — http(s), mailto, tel, etc. Leave alone.
    return href;
  }
  // Root-relative URLs (e.g. `/docs`, `/docs/meetings`, `/login`) and
  // protocol-relative URLs (`//host/path`) are already valid absolute
  // references — treating them as relative markdown file paths would
  // route them through `sourcePathToSlug`, which has no entry for them,
  // producing bogus "broken cross-link" warnings. Pass them through
  // unchanged.
  if (href.startsWith('/')) return href;

  // Relative path. Split off any trailing #fragment.
  const [pathPart, fragment = ''] = href.split('#');
  const normalized = normalizeMarkdownPath(pathPart);

  // Resolve against the article's source dir.
  const articleDir = posix.dirname(ctx.article.sourcePath);
  const resolvedSourcePath = posix.normalize(posix.join(articleDir, normalized));

  const slug = ctx.sourcePathToSlug[resolvedSourcePath];
  if (slug === undefined) {
    ctx.warnings.push(`broken cross-link in ${ctx.article.sourcePath}: ${href} → ${resolvedSourcePath} (no matching article)`);
    return href;
  }

  const url = slug === '' ? '/docs' : `/docs/${slug}`;
  return fragment ? `${url}#${fragment}` : url;
}

/**
 * Normalizes a markdown link target to the canonical source-file form so
 * `sourcePathToSlug` lookups hit consistently.
 *
 * @param {string} pathPart
 */
function normalizeMarkdownPath(pathPart) {
  let p = pathPart;
  // Strip trailing slash so `../foo/` and `../foo` resolve identically.
  if (p.endsWith('/')) p = `${p}index.md`;
  // Strip any explicit `index.md` suffix and the `.md` shortcut so
  // `../foo/index.md`, `../foo/`, and `../foo` all map to the same source.
  if (!p.endsWith('.md')) p = `${p}/index.md`;
  return p;
}

/**
 * @param {string} src
 * @param {BuildContext} ctx
 */
function rewriteImageSrc(src, ctx) {
  if (!src) return '';
  if (/^[a-z][a-z0-9+\-.]*:/i.test(src) || src.startsWith('/')) return src;
  // Resolve relative image paths against the article's source dir, then
  // express the result as `/docs-assets/...`. Image asset hosting is out of
  // scope at launch (no images in the launch corpus), so for now we just emit
  // the resolved path; if/when images are added, the build pipeline can copy
  // them into the dist tree under a stable prefix.
  const articleDir = posix.dirname(ctx.article.sourcePath);
  return posix.normalize(posix.join('/', articleDir, src));
}

/** @param {string} url */
function isAbsoluteUrl(url) {
  return /^[a-z][a-z0-9+\-.]*:/i.test(url);
}

/** @param {string} value */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Strips HTML tags from a string and returns the plain-text content.
 * Backed by `sanitize-html` (a real HTML parser) rather than a regex,
 * so adversarial inputs like `<<script>` or nested tags can't slip
 * through partial matching — closes CodeQL "incomplete multi-character
 * sanitization" alert. Used at build time on heading text for slug
 * generation; not user-facing input.
 *
 * @param {string} html
 */
function stripHtml(html) {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim();
}

/**
 * Slugifies heading text into a kebab-case anchor id. Conservative: ASCII
 * letters and digits, hyphens for everything else, collapsed.
 *
 * @param {string} text
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Returns a per-article-unique heading id by appending `-N` (N starting at 1)
 * to collisions. Two `## Overview` sub-headings in one article would otherwise
 * emit duplicate `id` attributes — invalid HTML where only the first anchor
 * resolves on click. Empty slugs (heading text that strips to nothing) are
 * normalized to `'section'` before deduplication so the assigned ids are
 * still meaningful.
 *
 * The seen-ids `Map` lives on `ctx`, scoped to one article; `createMarked`
 * builds a fresh `Marked` per article so cross-article collisions are
 * impossible by construction.
 *
 * @param {string} baseId  Output of `slugify(plainText)`.
 * @param {BuildContext} ctx
 * @returns {string}
 */
function uniqueHeadingId(baseId, ctx) {
  const safeBase = baseId || 'section';
  const seen = ctx.seenHeadingIds ?? (ctx.seenHeadingIds = new Map());
  const count = seen.get(safeBase) ?? 0;
  seen.set(safeBase, count + 1);
  return count === 0 ? safeBase : `${safeBase}-${count}`;
}
