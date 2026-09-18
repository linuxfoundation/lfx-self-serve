// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Scopes the embedded Gatewaze admin stylesheet so it cannot touch LFX chrome, and freezes its
 * rem units to px at LFX's 14px root so the host document and the Puck iframe render at one scale.
 *
 * That second clause used to say the rebase stops the embed shrinking inside a 14px-root host. It
 * does the opposite, and the same false claim was caught on the CLI wrapper in review. `0.875rem`
 * against a 14px root is 12.25px, which is exactly what the rebase writes — so in the host document
 * the conversion PRESERVES the shrink rather than preventing it. What it actually buys is the Puck
 * preview iframe, whose own root is the browser default 16px: without the freeze the same
 * declaration would render at 14px there and 12.25px here. See REM_BASELINE_PX below.
 *
 * The embed's library build emits one unscoped stylesheet (Tailwind 4 + Radix Themes + global
 * element resets) intended for a page it owns entirely. Dropped into LFX as-is it restyles the
 * host: its resets hit `html`/`body`, its `:root` custom properties collide with ours, and its
 * `@keyframes` names are global, so an animation named `enter` silently replaces any host
 * animation of the same name for the whole document.
 *
 * The pure transform lives here so it can be unit-tested; scripts/contain-gw-embed-css.mjs is the
 * CLI wrapper that reads and writes the files.
 */

import postcss from 'postcss';

/**
 * Every container the embed's styles must reach.
 *
 * `#gw-embed-root` is the mount point and `#gw-embed-portals` its sibling portal container — both
 * are needed because Radix renders overlays into the sibling rather than a descendant, so scoping
 * to the root alone leaves every dialog, dropdown and toast unstyled.
 *
 * `#frame-root` is the Puck editor's canvas root, which lives inside an `about:srcdoc` iframe
 * (`#preview-frame`). Puck copies the parent document's stylesheets into that iframe, but the
 * iframe has no `#gw-embed-root` in it — so with only the first two arms every copied rule matched
 * nothing and the canvas lost its block-selection outlines and hover toolbar entirely.
 *
 * `body:has(#frame-root)` is that same iframe's `<body>`, and it is a separate arm because
 * `#frame-root` does not contain everything the canvas renders. Puck portals each block's
 * selection overlay and its floating action bar to `ref.current.ownerDocument.body` — the iframe's
 * body, a SIBLING of `#frame-root`, not a descendant (see DraggableComponent's
 * `createPortal(..., portalEl || document.body)`). With only the `#frame-root` arm the overlay
 * layer fell outside the scope twice over: its own rules matched nothing, and the `--puck-color-*`
 * tokens the embed declares at `:root` were remapped onto the scope and so never reached it — an
 * `outline: 2px var(--puck-color-azure-09) solid` with an undefined custom property is an invalid
 * declaration, which is why the block outline and the action bar were absent rather than merely
 * misstyled, while the dotted field outlines inside `#frame-root` rendered fine.
 *
 * Both iframe arms are safe because they are unique to that iframe: `#frame-root` does not appear
 * in the host document, so `body:has(#frame-root)` does not match LFX's own body. And the iframe
 * needs no containment of its own — a separate document is already isolated by the browser.
 *
 * The `:not(:has(#gw-embed-root))` qualifier makes that structural rather than a standing
 * assumption about a third-party package. `#frame-root` is Puck's preview frame, which can be
 * configured to render WITHOUT an iframe, and `@gatewaze/admin-embed` is an external dependency
 * that moved 0.1.1 → 0.1.3 on this branch alone. If a future version ever renders `#frame-root`
 * into the host document, the unqualified arm would match LFX's own `<body>` — and with it every
 * rule remapped from `:root`/`html`/`body` plus the bare universal resets scoped as `SCOPE *`,
 * applying them document-wide. That is precisely the failure this whole transform exists to
 * prevent, arriving silently on a dependency bump. The host mount can never be inside the embed's
 * iframe, so excluding a body that also contains `#gw-embed-root` costs nothing in the real iframe
 * and closes the case entirely.
 */
export const SCOPE = ':is(#gw-embed-root, #gw-embed-portals, #frame-root, body:has(#frame-root):not(:has(#gw-embed-root)))';

/** Where the embed's own root-level declarations get remapped to. */
// Single selectors only. postcss splits `rule.selectors` before this is consulted, so a
// multi-selector string like '*, ::before, ::after' could never match an entry and was dead config
// that read as though the preflight list was handled as a unit. Each part arrives separately, and
// `*`/`::before`/`::after` are caught by their own branch in `scopeSelector` — not by falling
// through to the descendant branch, as an earlier version of this comment claimed. Both emit
// `:where(SCOPE) *`; the dedicated branch exists because a bare universal reset needs a descendant
// scope rather than being remapped onto the containers the way `:root` is.
const ROOT_SELECTORS = new Set([':root', 'html', 'body', ':host']);

/** Prefix for renamed global names, so embed and host can never collide. */
export const NAME_PREFIX = 'gw-embed-';

/**
 * The px value the embed's rem units are rebased to.
 *
 * This is LFX's root font size (`html { font-size: 14px }` in styles.scss), NOT the 16px the embed
 * was authored against — deliberately. Matching LFX exactly is the point: at 14px the embed's
 * `text-sm` (0.875rem) renders at 12.25px, precisely as `text-sm` does everywhere else in LFX.
 * Rebasing at 16 would have preserved Gatewaze's intended sizing but left every label in the panel
 * visibly larger than the chrome around it.
 *
 * rem resolves against the root element by definition, so no wrapper can rebase it — the choice is
 * between mutating the host's root (which would resize all of LFX) and converting at build time,
 * as here.
 */
export const REM_BASELINE_PX = 14;


/** At-rules that carry no selector and must pass through untouched. */
const OPAQUE_AT_RULES = new Set(['font-face', 'property', 'counter-style', 'font-feature-values', 'page', 'viewport']);

/** Converts `1.5rem` to `24px`, leaving `rem` inside strings, urls and var() names alone. */
function remToPx(value) {
  if (!value || !value.includes('rem')) {
    return value;
  }

  // Split on strings and url() so their contents are never rewritten.
  return value
    .split(/("[^"]*"|'[^']*'|url\([^)]*\))/g)
    .map((chunk, index) => {
      // Odd indices are the captured strings/urls — leave them exactly as they were.
      if (index % 2 === 1) {
        return chunk;
      }
      // Negative lookbehind keeps custom properties like `--x-rem` and words ending in "rem".
      return chunk.replace(/(?<![\w-])(-?\d*\.?\d+)rem\b/g, (_match, num) => `${parseFloat(num) * REM_BASELINE_PX}px`);
    })
    .join('');
}

/**
 * Scopes one selector so it can only ever match inside the embed's containers.
 *
 * `compoundRootSelectors` collects the unrebasable compound root selectors described below, so the
 * caller can fail the build rather than shipping rules that silently do nothing.
 */
function scopeSelector(selector, compoundRootSelectors) {
  const trimmed = selector.trim();

  // The embed's own root-level rules become rules on the containers themselves, rather than being
  // dropped. That keeps its base typography and design tokens working while making it impossible
  // for them to reach the host's html/body/:root.
  if (ROOT_SELECTORS.has(trimmed)) {
    return SCOPE;
  }

  // A bare universal reset (`*`, `::before`) would otherwise match the whole document.
  //
  // `:where()` like every other branch, and that is load-bearing rather than cosmetic. `:is()`
  // takes the specificity of its most specific argument, and SCOPE's arguments are IDs — so a bare
  // `${SCOPE} *` lands at (1,0,0) while every sibling rule, wrapped in `:where()`, keeps its
  // authored specificity. That inverts the embed's own cascade: Tailwind preflight's
  // `*, ::before, ::after { border: 0 solid }` would outrank the `hr { border-top-width: 1px }`
  // written to override it, and the same applies to every element- or class-level rule overriding
  // a preflight margin, padding, border or box-sizing declaration in the same layer.
  if (trimmed === '*' || trimmed === '::before' || trimmed === '::after') {
    return `:where(${SCOPE}) ${trimmed}`;
  }

  // Leading combinators appear inside nested rules; they are already relative and must not be
  // re-anchored.
  if (/^[>+~]/.test(trimmed)) {
    return trimmed;
  }

  // A COMPOUND root selector — `html.dark`, `body.is-monochrome:before`, `:root:where(:has(…))` —
  // qualifies the root element itself rather than describing a descendant. The root token is
  // replaced by the scope and the qualifiers stay attached to it, so `body.is-monochrome:before`
  // becomes `:where(SCOPE).is-monochrome:before`: still "the root element, when it also matches
  // these qualifiers", with the embed's containers standing in for the root.
  //
  // That is the meaning-preserving reading for every case here, because the thing each root token
  // refers to IS a scope arm. The embed's containers are its root, and the Puck rules qualify the
  // preview iframe's `<body>`, which `SCOPE` already carries as its fourth arm.
  //
  // This used to fall through to the descendant branch below and wrap as `:where(SCOPE) html.dark`,
  // which can never match — no `<html>` exists inside the scope — so the rule was silently dropped.
  // It was recorded as a latent problem on the assumption that the embed shipped no such selectors;
  // it ships five, including `body:has(._DropZone--isAnimating…:empty) [data-puck-overlay]`, so the
  // drag-animation and monochrome rules were being lost rather than merely at risk.
  //
  // `(?![\w-])` stops the token matching an identifier that merely starts with it — a `body-wrapper`
  // class or a `htmlfoo` element must not be folded onto the scope.
  const compoundRoot = trimmed.match(/^(?::root|html|body)(?![\w-])(?![\s>+~,]|$)(.*)$/s);
  if (compoundRoot) {
    compoundRootSelectors.add(trimmed);
    return `:where(${SCOPE})${compoundRoot[1]}`;
  }

  // Strip a leading html/body/:root qualifier and re-anchor the rest on the containers, so
  // `html .dark .card` becomes `<scope> .dark .card` rather than never matching.
  const rebased = trimmed.replace(/^(?::root|html|body)(?:\s*[>+~]\s*|\s+)/, '');
  const target = rebased || trimmed;

  // Already scoped — re-running the build step on its own output must be a no-op, not a
  // double-wrap. Both the bare and the :where()-wrapped forms count as scoped.
  if (target.startsWith(SCOPE) || target.startsWith(`:where(${SCOPE})`)) {
    return target;
  }

  // `:where()` keeps specificity at zero for the added scope, so the embed's internal cascade
  // (which was authored without it) is preserved exactly.
  return `:where(${SCOPE}) ${target}`;
}

/** Rewrites animation names in shorthand and longhand declarations. */
function renameAnimations(value, keyframeNames) {
  if (!value) {
    return value;
  }

  let next = value;
  for (const name of keyframeNames) {
    // Word-boundary match so `enter` doesn't rewrite `enter-from` or `fadeenter`.
    next = next.replace(new RegExp(`(?<![\\w-])${name}(?![\\w-])`, 'g'), `${NAME_PREFIX}${name}`);
  }
  return next;
}

export function containCss(css) {
  const root = postcss.parse(css);
  const stats = { rules: 0, keyframes: 0, dropped: 0, remValues: 0 };

  // Compound root selectors the scoping pass cannot rebase. Collected rather than repaired — see
  // scopeSelector for why the repair is not mechanical — and surfaced to the caller so a future
  // embed version shipping them fails the build instead of quietly losing the rules.
  const compoundRootSelectors = new Set();

  // Pass 1: collect keyframe names, so declarations can be rewritten in a single later pass.
  const keyframeNames = new Set();
  root.walkAtRules((atRule) => {
    if (atRule.name.toLowerCase().endsWith('keyframes')) {
      const name = atRule.params.trim();
      // An already-prefixed name needs no rewrite, and collecting it would make the reference
      // pass match its own output.
      if (!name.startsWith(NAME_PREFIX)) {
        keyframeNames.add(name);
      }
    }
  });

  // Pass 2: `@import` must not survive — everything is inlined at build time, and a surviving
  // import would fetch an unscoped stylesheet at runtime, defeating the whole transform.
  root.walkAtRules('import', (atRule) => {
    stats.dropped += 1;
    atRule.remove();
  });

  // Pass 3: rename keyframes so the embed's animations are private to it.
  root.walkAtRules((atRule) => {
    if (atRule.name.toLowerCase().endsWith('keyframes')) {
      const current = atRule.params.trim();
      // Skip names this transform already renamed, so a second run doesn't produce
      // `gw-embed-gw-embed-enter` and orphan every reference.
      if (!current.startsWith(NAME_PREFIX)) {
        atRule.params = `${NAME_PREFIX}${current}`;
        stats.keyframes += 1;
      }
    }
  });

  // Pass 4: scope every selector.
  root.walkRules((rule) => {
    // Keyframe steps (`from`, `50%`) are not selectors and must never be scoped.
    const parentAt = rule.parent?.type === 'atrule' ? rule.parent.name.toLowerCase() : '';
    if (parentAt.endsWith('keyframes')) {
      return;
    }
    if (OPAQUE_AT_RULES.has(parentAt)) {
      return;
    }

    rule.selectors = rule.selectors.map((selector) => scopeSelector(selector, compoundRootSelectors));
    stats.rules += 1;
  });

  // Pass 5: declaration values — rem rebase, plus animation-name rewrites.
  root.walkDecls((decl) => {
    // Inside @font-face/@property the value grammar is different and must be left alone, except
    // that rem there would still mis-scale, so the rem pass still applies.
    //
    // The IMMEDIATE parent is tested as well as the grandparent, and only the grandparent used to
    // be. Every `OPAQUE_AT_RULES` entry that holds declarations directly — `@font-face` and
    // `@property`, but `@counter-style`, `@page` and `@viewport` the same way — puts the at-rule at
    // `decl.parent`, leaving `decl.parent.parent` as the root. So `parentAt` came out empty and
    // every `OPAQUE_AT_RULES` check below was unreachable for exactly the rules they guard. The
    // grandparent arm still matters for a declaration inside a rule inside a conditional group
    // (`@media { .a { … } }`), which is the shape it was written against.
    const immediateAt = decl.parent?.type === 'atrule' ? decl.parent.name : '';
    const grandparentAt = decl.parent?.parent?.type === 'atrule' ? decl.parent.parent.name : '';
    const parentAt = (immediateAt || grandparentAt).toLowerCase();
    const original = decl.value;

    let next = remToPx(decl.value);
    if (next !== original) {
      stats.remValues += 1;
    }

    // `--animate-*` as well as the animation properties themselves. Tailwind 4 — which the embed
    // ships — does not put keyframe names in `animation` directly; it defines theme custom
    // properties like `--animate-spin: spin 1s linear infinite` and then writes
    // `animation: var(--animate-spin)`. Rewriting only the two animation properties renamed every
    // `@keyframes spin` to `gw-embed-spin` while leaving the custom property still naming `spin`,
    // so the reference resolved to nothing and every spinner in the embed silently stopped.
    //
    // Narrowed to the `--animate-` prefix rather than all custom properties: a custom property can
    // hold arbitrary text, and a blanket rewrite would corrupt any that happened to contain a word
    // matching a keyframe name — content strings and font stacks among them.
    const isAnimationProperty = /^(animation|animation-name)$/i.test(decl.prop);
    const isAnimationCustomProperty = decl.prop.toLowerCase().startsWith('--animate-');

    if (!OPAQUE_AT_RULES.has(parentAt) && (isAnimationProperty || isAnimationCustomProperty)) {
      next = renameAnimations(next, keyframeNames);
    }

    decl.value = next;
  });

  return { css: root.toString(), stats, keyframeNames: [...keyframeNames], compoundRootSelectors: [...compoundRootSelectors] };
}
