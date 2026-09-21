// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The email preview must never bind a SCRAPED url into an `<img [src]>`.
 *
 * Doing so makes the OPERATOR'S browser issue the request, before campaign-service's dial-time
 * guard is involved -- that guard runs when the draft is staged, not when the preview renders.
 * `canonicalHttpUrl` cannot prevent it: a scraped hostname can resolve to an RFC1918 or loopback
 * address, and `referrerpolicy` suppresses the referrer without stopping the fetch.
 *
 * Asserted against the TEMPLATE SOURCE, deliberately. The first version of this test queried the
 * rendered DOM from the component spec and was VACUOUS -- the preview block does not render in
 * that harness (`querySelectorAll('img')` returned 0), so it survived re-introducing an
 * `<img [src]="heroUrl">`. The template text is what decides whether a request is issued, and it
 * is the only thing that can be checked without a browser.
 */
describe('campaigns email preview template', () => {
  const template = readFileSync(join(process.cwd(), 'src/app/modules/dashboards/campaigns/campaigns.component.html'), 'utf8');

  it('was read, so the assertions below are not vacuous', () => {
    expect(template.length).toBeGreaterThan(1000);
    expect(template).toContain('campaigns-email-preview');
  });

  /**
   * Asserted as "no `<img>` has a BOUND src" rather than as a denylist of two expressions.
   *
   * The first version rejected `[src]="heroUrl"` and `[src]="sponsor.logoUrl"` literally, and
   * rotted the moment the `as heroUrl` alias was removed -- `[src]="emailHeroImageUrl()"` is the
   * same vector and sailed past it. Any bound src on an `<img>` in this preview is a
   * browser-issued request for a value the component computed, which is the thing that must not
   * happen; a static `src` (a bundled asset) is fine and is not matched.
   */
  it('never binds any computed value into an img src', () => {
    const bound = template.match(/<img\b[^>]*\[src\]=/g) ?? [];
    expect(bound).toEqual([]);
  });

  it('has no img element in the email preview block at all', () => {
    // The name promised an `<img>` check and the body only asserted a testid existed -- it could
    // not fail for the reason it claimed. It now scopes to the preview region and looks for the
    // element, so a STATIC `<img src="...">` (which the bound-src test above would miss) is
    // caught too: the preview names images rather than rendering them, so any `<img>` here is
    // the change worth knowing about.
    const start = template.indexOf('campaigns-email-preview-hero');
    expect(start).toBeGreaterThan(-1);
    const end = template.indexOf('campaigns-email-preview-cta', start);
    expect(end).toBeGreaterThan(start);

    // Comment BODIES are excluded by walking the region rather than by a strip-regex: the
    // preview carries a comment explaining why an `<img [src]>` is not used, and matching that
    // text would fail on the documentation of the very property asserted here. A
    // `replace(/<!--...-->/)` did that job but is the incomplete-multi-character-sanitization
    // shape CodeQL flags, and a partial strip is not worth defending in a test -- so the region
    // is split on comment boundaries and only the code between them is searched.
    const region = template.slice(start, end);
    const outsideComments = region
      .split('<!--')
      .map((part, index) => (index === 0 ? part : part.slice(part.indexOf('-->') + 3)))
      .join('');
    expect(outsideComments).not.toMatch(/<img\b/);
  });

  it('names the hero host instead, so the operator still knows a banner is coming', () => {
    expect(template).toContain('emailHeroImageHost()');
  });
});
