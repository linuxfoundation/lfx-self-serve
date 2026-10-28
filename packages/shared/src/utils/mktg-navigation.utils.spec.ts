// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { mktgKitRootPath, mktgRunRouteFor } from './mktg-navigation.utils';

describe('Marketing kit route roots', () => {
  it.each(['/project/mktg-os-agents', '/foundation/mktg-os-agents'])('preserves %s and strips document-only state', (base) => {
    expect(mktgKitRootPath(`${base}/documents/faq/living?project=synthetic&type=faq#sources`)).toBe(base);
    expect(mktgKitRootPath(`${base}?state=draft`)).toBe(base);
  });
  it.each([
    '/project/mktg-os-agents-x/documents',
    '/project/not-mktg-os-agents/documents',
    '/project/mktg-os-agentsSuffix',
    '/other?next=/mktg-os-agents',
    '/other#mktg-os-agents',
  ])('does not mistake a partial segment or query/fragment in %s for the Kit', (url) => expect(mktgKitRootPath(url)).toBe('/mktg-os-agents'));
  it('skips a containing segment before finding the real module segment', () => {
    expect(mktgKitRootPath('/mktg-os-agents-x/foundation/mktg-os-agents/faq')).toBe('/mktg-os-agents-x/foundation/mktg-os-agents');
  });
  it('builds Run again from the document type registry', () => {
    expect(mktgRunRouteFor('foundation-message', '/foundation/mktg-os-agents')).toEqual(['/foundation/mktg-os-agents', 'foundation-setup']);
    expect(mktgRunRouteFor('unknown', '/foundation/mktg-os-agents')).toBeUndefined();
  });
});
