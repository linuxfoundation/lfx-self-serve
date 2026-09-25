// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import sanitizeHtml from 'sanitize-html';

/**
 * Build-time HTML allowlist for rendered docs articles (research R4).
 *
 * The build pipeline runs marked → cross-link rewriter → THIS sanitizer, then
 * stores the result in the manifest. This pass is the single sanitization
 * boundary: at runtime the docs-article component trusts the stored string
 * via `bypassSecurityTrustHtml` (no second Angular sanitize pass), so
 * allowlisted attributes like heading ids reach the DOM. Never feed
 * non-repo-authored content into the manifest without revisiting this
 * allowlist — the runtime no longer re-sanitizes.
 *
 * Anything not in the allowlist is stripped silently. The intent is to
 * accept the prose, lists, tables, blockquotes, and inline code that show up
 * in real help content while rejecting anything script-bearing.
 */
const ALLOWED_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
  'figure',
  'figcaption',
  'a',
  'em',
  'strong',
  'img',
    'br',
    'span',
];

/**
 * Heading ids must match the shape `slugify()` emits (marked-config.mjs).
 * marked passes raw-HTML headings in authored markdown through untouched, so
 * without this a hand-written `<h2 id="...">` could carry any value into the
 * DOM — a DOM-clobbering vector (a named element shadows `window.foo` /
 * `document.foo`) now that the runtime no longer re-sanitizes.
 */
const SLUG_ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * transformTags handler for h1-h6: drops an `id` that doesn't match
 * SLUG_ID_PATTERN, keeps everything else. Runs before allowedAttributes
 * filtering, so a surviving id still has to be allowlisted for the tag.
 */
function dropUnsafeHeadingId(tagName, attribs) {
  if (attribs.id && !SLUG_ID_PATTERN.test(attribs.id)) {
    const { id: _dropped, ...rest } = attribs;
    return { tagName, attribs: rest };
  }
  return { tagName, attribs };
}

/**
 * Sanitizes a rendered HTML body and post-processes external links to add
 * `rel="noopener noreferrer"` and `target="_blank"`. Internal `/docs/...`
 * links are left as same-tab navigation so the runtime click-interceptor
 * (research R16) can convert them to `Router.navigateByUrl()` calls.
 *
 * @param {string} html
 * @returns {string}
 */
export function sanitizeDocsHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      // Heading anchor ids emitted by the marked renderer override; values
      // restricted to slugify() shape by dropUnsafeHeadingId.
      h1: ['id'],
      h2: ['id'],
      h3: ['id'],
      h4: ['id'],
      h5: ['id'],
      h6: ['id'],
      // span/code may carry a class for future syntax highlighting; the rest
      // of the allowlist ignores arbitrary classes.
      span: ['class'],
      code: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    transformTags: {
      h1: dropUnsafeHeadingId,
      h2: dropUnsafeHeadingId,
      h3: dropUnsafeHeadingId,
      h4: dropUnsafeHeadingId,
      h5: dropUnsafeHeadingId,
      h6: dropUnsafeHeadingId,
      a: (tagName, attribs) => {
        const href = attribs.href ?? '';
        // Protocol-relative URLs (//host or /\host) are external — don't
        // match them as internal just because they start with '/'.
        const isProtocolRelative = href.startsWith('//') || href.startsWith('/\\');
        const isInternal = (href.startsWith('/') && !isProtocolRelative) || href.startsWith('#');
        if (isInternal) {
          // Strip target/rel that may have leaked through from authored HTML;
          // keep them for external only.
          const { target: _t, rel: _r, ...rest } = attribs;
          return { tagName, attribs: rest };
        }
        return {
          tagName,
          attribs: {
            ...attribs,
            target: '_blank',
            rel: 'noopener noreferrer',
          },
        };
      },
    },
  });
}
