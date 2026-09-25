// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { sanitizeDocsHtml } from './sanitize.mjs';

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
    expect(sanitizeDocsHtml('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>');
  });

  it('strips event-handler attributes', () => {
    expect(sanitizeDocsHtml('<p onclick="alert(1)">x</p>')).toBe('<p>x</p>');
    const img = sanitizeDocsHtml('<img src="https://x.test/a.png" alt="a" onerror="alert(1)">');
    expect(img).not.toContain('onerror');
  });

  it('strips javascript: and other non-allowlisted URL schemes', () => {
    const link = sanitizeDocsHtml('<a href="javascript:alert(1)">x</a>');
    expect(link).not.toContain('javascript:');
    const img = sanitizeDocsHtml('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="x">');
    expect(img).not.toContain('data:');
  });

  it('strips <iframe> and other non-allowlisted tags', () => {
    expect(sanitizeDocsHtml('<iframe src="https://evil.test"></iframe><p>ok</p>')).toBe('<p>ok</p>');
  });

  it('strips style attributes', () => {
    expect(sanitizeDocsHtml('<p style="position:fixed;top:0">x</p>')).toBe('<p>x</p>');
  });

  it('preserves slug-shaped heading ids (the fragment deep-link contract)', () => {
    expect(sanitizeDocsHtml('<h2 id="public-meeting-access">Public meeting access</h2>')).toBe(
      '<h2 id="public-meeting-access">Public meeting access</h2>'
    );
  });

  it('drops heading ids outside the slugify() shape (DOM-clobbering guard)', () => {
    expect(sanitizeDocsHtml('<h2 id="Location Bar">x</h2>')).toBe('<h2>x</h2>');
    expect(sanitizeDocsHtml('<h3 id="UPPER_case">x</h3>')).toBe('<h3>x</h3>');
  });

  it('adds target=_blank rel="noopener noreferrer" to external links only', () => {
    expect(sanitizeDocsHtml('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>'
    );
    expect(sanitizeDocsHtml('<a href="/docs/meetings">x</a>')).toBe('<a href="/docs/meetings">x</a>');
    expect(sanitizeDocsHtml('<a href="#frag">x</a>')).toBe('<a href="#frag">x</a>');
  });

  it('treats protocol-relative URLs as external, not internal', () => {
    const out = sanitizeDocsHtml('<a href="//evil.test">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});
