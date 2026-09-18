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

  it("reaches the Puck iframe's body, where block overlays are portalled", () => {
    // Puck portals each block's selection outline and action bar to the iframe's <body>, a sibling
    // of #frame-root rather than a descendant, so the scope needs that body as its own arm. It is
    // keyed on #frame-root precisely so it cannot match the host's body.
    expect(SCOPE).toContain('body:has(#frame-root)');

    const { css } = containCss(':root { --puck-color-azure-09: blue; } ._DraggableComponent-overlay { outline: 2px solid; }');

    expect(css).toContain('body:has(#frame-root)');
    // The token has to land on the scope too — the overlay reads it, and an outline colour that
    // resolves to an undefined custom property drops the whole declaration.
    expect(css).toMatch(/--puck-color-azure-09:\s*blue/);
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

  it('folds a compound root selector onto the scope rather than losing the rule', () => {
    // This assertion used to pin the opposite: `body.no-scroll` wrapped as `:where(SCOPE)
    // body.no-scroll`, which can never match, and the lib recorded it as a known limitation on the
    // basis that the embed shipped no such selectors. It ships five — including a Puck
    // drag-animation rule — so the rules were being dropped, not merely at risk.
    const { css } = containCss('body.no-scroll { overflow: hidden }');

    expect(css).toContain(`:where(${SCOPE}).no-scroll`);
  });

  it('cannot scope a rule to a host body that also contains the embed mount', () => {
    // #frame-root is Puck's preview frame, which CAN be configured to render without an iframe,
    // and the embed is an external dependency that moved three versions on this branch alone. If a
    // future release ever renders #frame-root into the host document, an unqualified
    // `body:has(#frame-root)` would match LFX's own body and apply every :root/html/body remap plus
    // the universal resets document-wide — the exact failure this transform exists to prevent.
    expect(SCOPE).toContain(':not(:has(#gw-embed-root))');

    const { css } = containCss(':root { --x: 1px }');

    // The body arm is present (so the real iframe is still covered) and qualified (so it cannot
    // match a document that hosts the embed mount).
    expect(css).toContain('body:has(#frame-root):not(:has(#gw-embed-root))');
    expect(css).not.toMatch(/body:has\(#frame-root\)(?!:not)/);
  });

  it('renames keyframes referenced through a Tailwind --animate-* custom property', () => {
    // Tailwind 4 — which the embed ships — does not put keyframe names in `animation` directly. It
    // defines `--animate-spin: spin 1s linear infinite` and writes `animation: var(--animate-spin)`.
    // Rewriting only the animation properties renamed the @keyframes and left the custom property
    // pointing at the old name, so every spinner in the embed silently stopped.
    const { css } = containCss('@keyframes spin { to { transform: rotate(360deg) } } :root { --animate-spin: spin 1s linear infinite; } .a { animation: var(--animate-spin); }');

    expect(css).toContain(`@keyframes ${NAME_PREFIX}spin`);
    expect(css).toContain(`--animate-spin: ${NAME_PREFIX}spin 1s linear infinite`);
  });

  it('leaves custom properties that are not --animate-* alone', () => {
    // A custom property can hold arbitrary text, so a blanket rewrite would corrupt any that
    // happened to contain a word matching a keyframe name — content strings and font stacks among
    // them. Only the --animate- prefix is treated as naming a keyframe.
    const { css } = containCss('@keyframes spin { to { opacity: 1 } } :root { --label: "spin"; --font: spin, sans-serif; }');

    expect(css).toContain('--label: "spin"');
    expect(css).toContain('--font: spin, sans-serif');
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

  it("rebases rem against LFX's 14px root so sizes match the surrounding chrome", () => {
    const { css } = containCss('.a { padding: 1rem; margin: 0.5rem 2rem; }');

    expect(css).toContain('padding: 14px');
    expect(css).toContain('margin: 7px 28px');
  });

  it("renders the embed's text-sm at exactly LFX's text-sm", () => {
    // Both sides use Tailwind's 0.875rem for `sm`; LFX resolves it against a 14px root, so parity
    // means 12.25px here too. This is the assertion that would catch a silent baseline change.
    const { css } = containCss('.a { font-size: 0.875rem; }');

    expect(css).toContain('font-size: 12.25px');
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

  describe('compound root selectors', () => {
    // These qualify the root element itself rather than describing a descendant, so the root token
    // is REPLACED by the scope with its qualifiers still attached — not stripped, which would turn
    // a compound into a descendant match, and not left alone, which is what used to happen and
    // produced `:where(SCOPE) html.dark`: unmatchable, because no <html> exists inside the scope.
    it.each([
      ['a class on the root', 'html.dark { color: white }', `:where(${SCOPE}).dark`],
      ['a class with a pseudo-element', 'body.is-monochrome:before { content: "" }', `:where(${SCOPE}).is-monochrome:before`],
      ['a functional pseudo-class', ':root:where(:has(.radix-themes)) { --x: 1px }', `:where(${SCOPE}):where(:has(.radix-themes))`],
      ['a qualifier plus a descendant', 'body:has(.dz:empty) [data-puck-overlay] { outline: 0 }', `:where(${SCOPE}):has(.dz:empty) [data-puck-overlay]`],
    ])('folds %s onto the scope', (_label, input, expected) => {
      expect(containCss(input).css).toContain(expected);
    });

    it('reports what it folded, so the count is visible in the build log', () => {
      const { compoundRootSelectors } = containCss('html.dark { color: white } body.x { margin: 0 }');

      expect(compoundRootSelectors).toEqual(['html.dark', 'body.x']);
    });

    it('leaves an identifier that merely starts with a root token alone', () => {
      // `body-wrapper` is a class, not the root element with a qualifier. Folding it would silently
      // retarget the rule at the embed container.
      const { css, compoundRootSelectors } = containCss('.body-wrapper .card { color: red } bodyfoo { color: blue }');

      expect(compoundRootSelectors).toEqual([]);
      expect(css).toContain(`:where(${SCOPE}) .body-wrapper .card`);
      expect(css).toContain(`:where(${SCOPE}) bodyfoo`);
    });

    it('still produces no rule that can escape the scope', () => {
      // The whole point of the transform. A fold that emitted a bare `html.dark` would restyle the
      // host document the moment the stylesheet loaded.
      const { css } = containCss('html.dark { color: white } body.is-monochrome:before { content: "" }');

      expect(css).not.toMatch(/(^|})\s*(html|body|:root)[.:[]/);
    });
  });

  it('is idempotent, so re-running the build step cannot double-scope', () => {
    const once = containCss('.card { color: red }').css;
    const twice = containCss(once).css;

    expect(twice).toBe(once);
  });
});
