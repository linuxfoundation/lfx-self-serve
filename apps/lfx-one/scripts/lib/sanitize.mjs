// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import sanitizeHtml from 'sanitize-html';

/**
 * Build-time HTML allowlist for rendered docs articles (research R4).
 *
 * The build pipeline runs marked → cross-link rewriter → THIS sanitizer, then
 * stores the result in the manifest. At runtime, Angular binds the stored
 * string via `[innerHTML]` (NOT `bypassSecurityTrustHtml`), which gives us a
 * second sanitization pass for free.
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
      // Heading anchor ids emitted by the marked renderer override.
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
