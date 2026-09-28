// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { sanitizeDocsHtml } from './sanitize.mjs';

/** Stand-in for the article's own absolute URL (`docsArticleUrl(slug)`). */
const ARTICLE_URL = '/docs/topic/article';

/**
 * Regression pin for the build-time sanitize allowlist. The docs-article
 * component trusts manifest HTML via `bypassSecurityTrustHtml`, so this pass
 * is the ONLY sanitization boundary — a widened allowlist (a later edit, or a
 * sanitize-html upgrade changing a default) would reach a public [innerHTML]
 * sink as live XSS with no runtime backstop. Each assertion maps to a shape
 * that must never survive.
 */
describe('sanitizeDocsHtml', () => {
  it('strips <script> elements and their contents', () => {
    expect(sanitizeDocsHtml('<p>ok</p><script>alert(1)</script>', ARTICLE_URL)).toBe('<p>ok</p>');
  });

  it('strips event-handler attributes', () => {
    expect(sanitizeDocsHtml('<p onclick="alert(1)">x</p>', ARTICLE_URL)).toBe('<p>x</p>');
    const img = sanitizeDocsHtml('<img src="https://x.test/a.png" alt="a" onerror="alert(1)">', ARTICLE_URL);
    expect(img).not.toContain('onerror');
  });

  it('strips javascript: and other non-allowlisted URL schemes', () => {
    const link = sanitizeDocsHtml('<a href="javascript:alert(1)">x</a>', ARTICLE_URL);
    expect(link).not.toContain('javascript:');
    const img = sanitizeDocsHtml('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="x">', ARTICLE_URL);
    expect(img).not.toContain('data:');
  });

  it('strips <iframe> and other non-allowlisted tags', () => {
    expect(sanitizeDocsHtml('<iframe src="https://evil.test"></iframe><p>ok</p>', ARTICLE_URL)).toBe('<p>ok</p>');
  });

  it('strips style attributes', () => {
    expect(sanitizeDocsHtml('<p style="position:fixed;top:0">x</p>', ARTICLE_URL)).toBe('<p>x</p>');
  });

  it('preserves slug-shaped heading ids (the fragment deep-link contract)', () => {
    expect(sanitizeDocsHtml('<h2 id="public-meeting-access">Public meeting access</h2>', ARTICLE_URL)).toBe(
      '<h2 id="public-meeting-access">Public meeting access</h2>'
    );
  });

  it('drops heading ids outside the slugify() shape (DOM-clobbering guard)', () => {
    expect(sanitizeDocsHtml('<h2 id="Location Bar">x</h2>', ARTICLE_URL)).toBe('<h2>x</h2>');
    expect(sanitizeDocsHtml('<h3 id="UPPER_case">x</h3>', ARTICLE_URL)).toBe('<h3>x</h3>');
  });

  it('adds target=_blank rel="noopener noreferrer" to external links only', () => {
    expect(sanitizeDocsHtml('<a href="https://example.com">x</a>', ARTICLE_URL)).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>'
    );
    expect(sanitizeDocsHtml('<a href="/docs/meetings">x</a>', ARTICLE_URL)).toBe('<a href="/docs/meetings">x</a>');
    // Bare fragments stay internal after the rewrite — no target/rel added.
    expect(sanitizeDocsHtml('<a href="#frag">x</a>', ARTICLE_URL)).toBe('<a href="/docs/topic/article#frag">x</a>');
  });

  it('resolves bare #fragment hrefs against the article URL', () => {
    // Raw-HTML anchors pass marked untouched, so this transform is the only
    // place they get canonicalized — the runtime resolution was removed
    // because it could never cover `auxclick` middle-clicks or context-menu
    // opens. Root-article URL shape (`/docs#x`) is pinned in
    // marked-config.spec.mjs (`docsArticleUrl`).
    expect(sanitizeDocsHtml('<a href="#section-2">x</a>', ARTICLE_URL)).toBe('<a href="/docs/topic/article#section-2">x</a>');
    expect(sanitizeDocsHtml('<a href="#">x</a>', ARTICLE_URL)).toBe('<a href="/docs/topic/article#">x</a>');
  });

  it('treats protocol-relative URLs as external, not internal', () => {
    const out = sanitizeDocsHtml('<a href="//evil.test">x</a>', ARTICLE_URL);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});
