// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Scopes the embedded Gatewaze admin stylesheet so it cannot touch LFX chrome, and rebases its
 * rem units so it does not shrink inside a 14px-root host.
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
 * Both containers must be covered. Radix renders overlays into the portal container, which is a
 * sibling of the embed root rather than a descendant — prefixing only the root would leave every
 * dialog, dropdown and toast unstyled.
 */
export const SCOPE = ':is(#gw-embed-root, #gw-embed-portals)';

/** Where the embed's own root-level declarations get remapped to. */
const ROOT_SELECTORS = new Set([':root', 'html', 'body', ':host', '*, ::before, ::after', ':root, :host']);

/** Prefix for renamed global names, so embed and host can never collide. */
export const NAME_PREFIX = 'gw-embed-';

/**
 * The rem baseline the embed's styles were authored against.
 *
 * LFX sets `html { font-size: 14px }`, so every rem in the embed would resolve 12.5% small. rem is
 * defined against the root element, so no wrapper can rebase it — the alternatives are mutating the
 * host's root (rejected: it would resize all of LFX) or converting at build time, as here.
 */
export const REM_BASELINE_PX = 16;

/** At-rules whose children are ordinary rules and must be scoped in place. */
const NESTED_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style']);

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

/** Scopes one selector so it can only ever match inside the embed's containers. */
function scopeSelector(selector, keyframeNames) {
  const trimmed = selector.trim();

  // The embed's own root-level rules become rules on the containers themselves, rather than being
  // dropped. That keeps its base typography and design tokens working while making it impossible
  // for them to reach the host's html/body/:root.
  if (ROOT_SELECTORS.has(trimmed)) {
    return SCOPE;
  }

  // A bare universal reset (`*`, `::before`) would otherwise match the whole document.
  if (trimmed === '*' || trimmed === '::before' || trimmed === '::after') {
    return `${SCOPE} ${trimmed}`;
  }

  // Leading combinators appear inside nested rules; they are already relative and must not be
  // re-anchored.
  if (/^[>+~]/.test(trimmed)) {
    return trimmed;
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

    rule.selectors = rule.selectors.map((selector) => scopeSelector(selector, keyframeNames));
    stats.rules += 1;
  });

  // Pass 5: declaration values — rem rebase, plus animation-name rewrites.
  root.walkDecls((decl) => {
    const parentAt = decl.parent?.parent?.type === 'atrule' ? decl.parent.parent.name.toLowerCase() : '';
    // Inside @font-face/@property the value grammar is different and must be left alone, except
    // that rem there would still mis-scale, so the rem pass still applies.
    const original = decl.value;

    let next = remToPx(decl.value);
    if (next !== original) {
      stats.remValues += 1;
    }

    if (!OPAQUE_AT_RULES.has(parentAt) && /^(animation|animation-name)$/i.test(decl.prop)) {
      next = renameAnimations(next, keyframeNames);
    }

    decl.value = next;
  });

  return { css: root.toString(), stats, keyframeNames: [...keyframeNames] };
}
