// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { normalizeLinkedInCreativeName } from './campaign-linkedin.utils';
import { compactLinkedInVariantFields, linkedInVariantFieldsRefusal } from './campaign-linkedin-variant-fields.utils';

const ON = { copy: true, callToAction: true };
const ad = (fields: Record<string, unknown>) => ({ introText: 'Join us', headline: 'Summit', ...fields });
const config = (...variants: unknown[]) => ({ variants });

describe('linkedInVariantFieldsRefusal', () => {
  it.each([
    ['no optional fields', config(ad({})), ON],
    ['every field set', config(ad({ name: 'Ad A', description: 'Two days of talks', callToAction: 'register' })), ON],
    ['null and blank fields', config(ad({ name: null, description: '', callToAction: '  ' })), ON],
    ['two unnamed ads', config(ad({}), ad({ name: '' })), ON],
    ['absent fields on a deployment that sends none', config(ad({})), { copy: false, callToAction: false }],
    ['blank fields on a deployment that sends none', config(ad({ name: ' ', description: '', callToAction: '  ' })), { copy: false, callToAction: false }],
    ['no variants', {}, ON],
    ['a variant that is not an object', config('text'), ON],
    ['a name at the limit', config(ad({ name: 'n'.repeat(255) })), ON],
    ['a description at the limit', config(ad({ description: 'd'.repeat(300) })), ON],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(linkedInVariantFieldsRefusal(raw, enabled)).toBeNull();
  });

  it.each([
    ['a name without the cutover', config(ad({ name: 'Ad A' })), { copy: false, callToAction: true }, 'variants[0].name', 'cannot send a LinkedIn ad name'],
    ['a description without the cutover', config(ad({ description: 'x' })), { copy: false, callToAction: true }, 'variants[0].description', 'cannot send'],
    [
      'a call to action without its flag',
      config(ad({ callToAction: 'REGISTER' })),
      { copy: true, callToAction: false },
      'variants[0].callToAction',
      'cannot send',
    ],
    ['a name that is not text', config(ad({ name: 7 })), ON, 'variants[0].name', 'must be text'],
    ['a name over 255', config(ad({ name: 'n'.repeat(256) })), ON, 'variants[0].name', 'at most 255'],
    ['a description over 300', config(ad({ description: 'd'.repeat(301) })), ON, 'variants[0].description', 'at most 300'],
    ['an unknown call to action', config(ad({ callToAction: 'CLICK_HERE' })), ON, 'variants[0].callToAction', 'must be one of APPLY'],
    ['a repeated name once normalized', config(ad({ name: 'Ad  A' }), ad({ name: ' Ad A\n' })), ON, 'variants[1].name', 'same name as ad 1'],
  ])('refuses %s', (_name, raw, enabled, field, message) => {
    const refusal = linkedInVariantFieldsRefusal(raw, enabled);
    expect(refusal?.field).toBe(`linkedInConfig.${field}`);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes a caller value', () => {
    expect(linkedInVariantFieldsRefusal(config(ad({ callToAction: 'SECRET_LABEL' })), ON)?.message).not.toContain('SECRET_LABEL');
  });
});

describe('compactLinkedInVariantFields', () => {
  it.each([
    [
      { name: '  Ad\tA ', description: 'Talks', callToAction: ' learn_more ' },
      { name: 'Ad A', description: 'Talks', callToAction: 'LEARN_MORE' },
    ],
    [{ name: '   ', description: '', callToAction: '' }, {}],
    [{}, {}],
  ])('sends %j as %j', (variant, expected) => {
    expect(compactLinkedInVariantFields(variant)).toEqual(expected);
  });
});

describe('normalizeLinkedInCreativeName', () => {
  it.each([
    ['  OSSNA 2026 – Skill Up ', 'OSSNA 2026 – Skill Up'],
    ['a\n\tb  c', 'a b c'],
    ['   ', ''],
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalizeLinkedInCreativeName(raw)).toBe(expected);
  });
});
