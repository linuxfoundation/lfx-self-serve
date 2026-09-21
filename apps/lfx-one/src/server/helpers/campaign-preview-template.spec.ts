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

  it.each([
    ['the scraped hero image', /<img[^>]*\[src\]="heroUrl"/],
    ['a scraped sponsor logo', /<img[^>]*\[src\]="sponsor\.logoUrl"/],
  ])('never binds %s into an img src', (_label, pattern) => {
    expect(template).not.toMatch(pattern);
  });

  it('names the hero host instead, so the operator still knows a banner is coming', () => {
    expect(template).toContain('emailHeroImageHost()');
  });
});
