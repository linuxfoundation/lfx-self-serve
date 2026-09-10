// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { containCss, NAME_PREFIX, SCOPE } from './lib/contain-gw-embed-css.mjs';

/**
 * The embed's stylesheet is authored for a page it owns outright. These assertions are what stops
 * it from redecorating LFX when it is dropped into one of our routes — each maps to a way the
 * unscoped sheet was observed to leak.
 */
describe('containCss', () => {
  it('scopes an ordinary rule to the embed containers', () => {
    const { css } = containCss('.card { color: red; }');

    expect(css).toContain(`:where(${SCOPE}) .card`);
  });

  it('remaps root-level selectors onto the containers rather than the host document', () => {
    const { css } = containCss(':root { --accent: blue; } html { font-size: 16px; } body { margin: 0; }');

    // The declarations survive — they just land on the embed's own containers.
    expect(css).toContain(`${SCOPE} {`);
    // Nothing may still target the host's root elements.
    expect(css).not.toMatch(/(^|})\s*(html|body|:root)\s*\{/);
  });

  it('scopes a bare universal reset so it cannot match the whole document', () => {
    const { css } = containCss('* { box-sizing: border-box; }');

    expect(css).toContain(`${SCOPE} *`);
    expect(css).not.toMatch(/(^|})\s*\*\s*\{/);
  });

  it('renames keyframes and every reference to them', () => {
    const { css } = containCss('@keyframes enter { from { opacity: 0 } } .a { animation: enter 1s ease; }');

    expect(css).toContain(`@keyframes ${NAME_PREFIX}enter`);
    expect(css).toContain(`animation: ${NAME_PREFIX}enter 1s ease`);
    // A host animation of the same name must be left alone, which only holds if nothing
    // unprefixed survives.
    expect(css).not.toMatch(/@keyframes\s+enter\b/);
  });

  it('does not rewrite names that merely contain a keyframe name', () => {
    const { css } = containCss('@keyframes enter { from { opacity: 0 } } .a { animation-name: enter-from; }');

    expect(css).toContain('animation-name: enter-from');
  });

  it('leaves keyframe steps alone', () => {
    const { css } = containCss('@keyframes spin { from { opacity: 0 } to { opacity: 1 } }');

    expect(css).toMatch(/\bfrom\s*\{/);
    expect(css).not.toContain(`:where(${SCOPE}) from`);
  });

  it('rebases rem against the 16px baseline the embed was authored for', () => {
    const { css } = containCss('.a { padding: 1rem; margin: 0.5rem 2rem; }');

    expect(css).toContain('padding: 16px');
    expect(css).toContain('margin: 8px 32px');
  });

  it('leaves rem inside strings and urls untouched', () => {
    const { css } = containCss('.a { content: "1rem"; background: url(a-1rem.png); }');

    expect(css).toContain('"1rem"');
    expect(css).toContain('a-1rem.png');
  });

  it('does not mistake a custom property ending in rem for a length', () => {
    const { css } = containCss('.a { width: var(--x-rem); }');

    expect(css).toContain('var(--x-rem)');
  });

  it('recurses into conditional groups and layers', () => {
    const { css } = containCss('@media (min-width: 40rem) { @layer utilities { .a { color: red } } }');

    expect(css).toContain(`:where(${SCOPE}) .a`);
    // Media query params resolve against the initial font size, not the host root, so they are
    // deliberately left in rem.
    expect(css).toContain('(min-width: 40rem)');
  });

  it('passes @font-face through without a selector prefix', () => {
    const { css } = containCss('@font-face { font-family: Inter; src: url(i.woff2); }');

    expect(css).toContain('@font-face');
    expect(css).not.toContain(`:where(${SCOPE}) @font-face`);
  });

  it('drops @import so no unscoped stylesheet is fetched at runtime', () => {
    const { css, stats } = containCss('@import "https://example.test/x.css"; .a { color: red }');

    expect(css).not.toContain('@import');
    expect(stats.dropped).toBe(1);
  });

  it('re-anchors a selector that was qualified by a root element', () => {
    const { css } = containCss('html .dark .card { color: red }');

    expect(css).toContain(`:where(${SCOPE}) .dark .card`);
  });

  it('is idempotent, so re-running the build step cannot double-scope', () => {
    const once = containCss('.card { color: red }').css;
    const twice = containCss(once).css;

    expect(twice).toBe(once);
  });
});
