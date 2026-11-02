// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Deliberate shared-to-app filesystem guard, like constants/index.spec.ts:
// only this Node CI spec reads app files; production shared code never depends on them.
describe('Marketing OS breadcrumb ownership', () => {
  const root = fileURLToPath(new URL('../../../../apps/lfx-one/src/app/modules/mktg-os-agents/', import.meta.url));
  const allowed = 'components/mktg-breadcrumb/mktg-breadcrumb.component.html';
  // Catch labels on any element, including bound attributes, plus unlabeled breadcrumb nav testids.
  const breadcrumbNav = /<[^>]+\baria-?label\]?\s*=\s*["'][^>]*breadcrumb|<nav\b[^>]*\bdata-testid\s*=\s*["'][^>]*breadcrumb/i;

  it(`allows breadcrumb navigation only in ${allowed}`, () => {
    const templates = readdirSync(root, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith('.html'));
    expect(templates).toContain(allowed);
    const offenders = templates.filter((path) => path !== allowed && breadcrumbNav.test(readFileSync(`${root}/${path}`, 'utf8')));
    expect(offenders, `Use lfx-mktg-breadcrumb; only ${allowed} may render the breadcrumb nav`).toEqual([]);
  });

  it.each([
    '<nav aria-label="Breadcrumb"><ol /></nav>',
    "<nav aria-label = 'breadcrumb'><ol /></nav>",
    '<nav [attr.aria-label]="\'Breadcrumb\'"><ol /></nav>',
    '<nav [ariaLabel]="\'Breadcrumb\'"><ol /></nav>',
    '<div role="navigation" aria-label="Breadcrumb"><ol /></div>',
    '<div aria-label="Breadcrumb" role="navigation"><ol /></div>',
    '<nav data-testid="mktg-breadcrumb"><ol /></nav>',
  ])('detects hand-built markup: %s', (markup) => expect(breadcrumbNav.test(markup)).toBe(true));
  it('permits the shared component call and unrelated navigation', () => {
    expect(breadcrumbNav.test('<lfx-mktg-breadcrumb [page]="page()" />')).toBe(false);
    expect(breadcrumbNav.test('<nav aria-label="Kit tabs"></nav>')).toBe(false);
  });
});
