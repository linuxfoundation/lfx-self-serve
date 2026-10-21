// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { mktgKitCrumbsFor, mktgKitRootCrumb, mktgKitRootPath, mktgRunRouteFor } from './mktg-navigation.utils';

describe('fixed Marketing kit parents', () => {
  const base = '/foundation/mktg-os-agents';
  it('builds the root label once with an optional parent target and neutral fallback', () => {
    expect(mktgKitRootCrumb('Synthetic Project', [base])).toEqual({ label: 'Synthetic Project kit', route: [base] });
    expect(mktgKitRootCrumb('')).toEqual({ label: 'Project kit' });
  });
  it('preserves the lens and strips asset-only state', () => {
    expect(mktgKitRootPath(`${base}/documents/faq/living?project=synthetic&type=faq#sources`)).toBe(base);
    expect(mktgKitRootPath('/project/mktg-os-agents?state=draft')).toBe('/project/mktg-os-agents');
  });
  it.each(['foundation-message', 'foundation-setup', 'brand-kit', 'boilerplates', 'faq', 'icp'])('links %s to Positioning & brand', (key) => {
    expect(mktgKitCrumbsFor(key, 'Synthetic Project', base, 'Asset')).toEqual([
      { label: 'Synthetic Project kit', route: [base] },
      { label: 'Positioning & brand', route: [base, 'families', 'positioning-brand'] },
      { label: 'Asset' },
    ]);
  });
  it.each([
    ['aeo-geo', 'website-web'],
    ['linkedin-post', 'social-community'],
    ['member-360', 'member-sponsor'],
  ])('uses the catalog family for %s', (key, family) => {
    expect(mktgKitCrumbsFor(key, 'Synthetic Project', base, 'Run')[1].route).toEqual([base, 'families', family]);
  });
  it('uses Documents for assets outside a family and never links the current page', () => {
    const crumbs = mktgKitCrumbsFor('legacy-output', '', base, 'Legacy document');
    expect(crumbs[0].label).toBe('Project kit');
    expect(crumbs[1]).toEqual({ label: 'Documents', route: [base, 'documents'] });
    expect(crumbs[2].route).toBeUndefined();
  });
  it('builds Run again from the document type registry', () => {
    expect(mktgRunRouteFor('foundation-message', base)).toEqual([base, 'foundation-setup']);
    expect(mktgRunRouteFor('unknown', base)).toBeUndefined();
  });
});
