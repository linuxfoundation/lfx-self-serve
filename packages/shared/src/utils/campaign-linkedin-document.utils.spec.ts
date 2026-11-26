// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInConfigKeyRefusal } from './campaign-linkedin-config.utils';
import { linkedInConfigIsDocument, linkedInDocumentRefusal } from './campaign-linkedin-document.utils';

const PDF = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const document = (fields: Record<string, unknown> = {}) => ({
  format: 'document',
  documentAssetId: PDF,
  documentTitle: 'KubeCon sponsor prospectus',
  documentIntroText: 'Sponsor KubeCon',
  variants: [],
  ...fields,
});

describe('linkedInDocumentRefusal', () => {
  it.each([
    ['no document field, on a deployment without documents', { format: 'single_image', variants: [] }, false],
    // campaign-service reads "" as omitted.
    ['empty document fields without the format, on a deployment without documents', { documentTitle: '', documentIntroText: '' }, false],
    ['an engagement document', document(), true],
    ['a gated (lead generation) document', document({ objective: 'lead_generation', leadGenForm: '123' }), true],
    ['an empty objective, which campaign-service reads as omitted', document({ objective: '' }), true],
    ['automatic bidding', document({ bidding: { strategy: 'automatic' } }), true],
    ['an empty carousel intro text', document({ carouselIntroText: '' }), true],
    ['a 70-character title and a 600-character intro', document({ documentTitle: 't'.repeat(70), documentIntroText: 'i'.repeat(600) }), true],
    // A dash becomes ", " before it is counted, as campaign-service normalizes it.
    ['a title of 68 characters and a dash', document({ documentTitle: `${'t'.repeat(68)}—` }), true],
    ['not an object', null, true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(linkedInDocumentRefusal(raw, enabled)).toBeNull();
  });

  it.each([
    ['the format without the flag', document(), false, 'format', 'cannot create LinkedIn document ads'],
    ['an asset id without the flag', { documentAssetId: PDF }, false, 'documentAssetId', 'cannot create LinkedIn document ads'],
    ['a title without the flag', { documentTitle: 'Hi' }, false, 'documentTitle', 'cannot create LinkedIn document ads'],
    ['a null title', document({ documentTitle: null }), true, 'documentTitle', 'as text'],
    ['a number asset id', document({ documentAssetId: 7 }), true, 'documentAssetId', 'as text'],
    ['an asset id without the format', { documentAssetId: PDF }, true, 'documentAssetId', 'only with the document format'],
    ['an intro with the carousel format', { format: 'carousel', documentIntroText: 'Hi' }, true, 'documentIntroText', 'only with the document format'],
    ['single image ads beside the document', document({ variants: [{ introText: 'a', headline: 'b' }] }), true, 'variants', 'Send no single image'],
    ['text ads beside the document', document({ textAds: [] }), true, 'textAds', 'text ad format'],
    ['a null text ads list beside the document', document({ textAds: null }), true, 'textAds', 'text ad format'],
    ['carousel cards beside the document', document({ carouselCards: [] }), true, 'carouselCards', 'carousel format'],
    ['a carousel intro beside the document', document({ carouselIntroText: 'Hi' }), true, 'carouselIntroText', 'carousel format'],
    ['the website visits objective', document({ objective: 'traffic' }), true, 'objective', 'no website visits or conversions'],
    ['the conversions objective', document({ objective: 'conversions' }), true, 'objective', 'no website visits or conversions'],
    ['a manual bid', document({ bidding: { strategy: 'manual', bidAmount: 5 } }), true, 'bidding', 'automatic bidding only'],
    [
      'a manual bid on a gated document',
      document({ objective: 'lead_generation', bidding: { strategy: 'manual' } }),
      true,
      'bidding',
      'automatic bidding only',
    ],
    ['no asset id', document({ documentAssetId: '  ' }), true, 'documentAssetId', 'Choose the PDF'],
    ['an asset id that is not a UUID', document({ documentAssetId: 'deck.pdf' }), true, 'documentAssetId', 'stored for this brief'],
    [
      'an unhyphenated UUID, which the asset store never issues',
      document({ documentAssetId: PDF.replaceAll('-', '') }),
      true,
      'documentAssetId',
      'stored for this brief',
    ],
    ['a blank title', document({ documentTitle: ' ' }), true, 'documentTitle', 'Enter the document title'],
    ['a dash-only title', document({ documentTitle: '—' }), true, 'documentTitle', 'Enter the document title'],
    ['a 71-character title', document({ documentTitle: 't'.repeat(71) }), true, 'documentTitle', 'at most 70'],
    ['no intro text', (({ documentIntroText: _omitted, ...rest }) => rest)(document()), true, 'documentIntroText', 'Enter the document intro text'],
    ['a 601-character intro', document({ documentIntroText: 'i'.repeat(601) }), true, 'documentIntroText', 'at most 600'],
  ])('refuses %s', (_name, raw, enabled, field, message) => {
    const refusal = linkedInDocumentRefusal(raw, enabled);
    expect(refusal?.field).toBe(`linkedInConfig.${field}`);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes a caller value', () => {
    const value = 'leaked-caller-value';
    for (const raw of [document({ documentAssetId: value }), document({ objective: value }), { documentTitle: value }]) {
      expect(linkedInDocumentRefusal(raw, true)?.message).not.toContain(value);
    }
  });
});

describe('the document keys', () => {
  it('are sent, spelled exactly', () => {
    expect(linkedInConfigKeyRefusal(document())).toBeNull();
    // campaign-service decodes keys ignoring case, so another spelling is refused rather than forwarded past these checks.
    expect(linkedInConfigKeyRefusal({ ...document(), DocumentAssetId: PDF })).not.toBeNull();
  });
});

describe('linkedInConfigIsDocument', () => {
  it.each([
    [document(), true],
    [{ format: 'carousel' }, false],
    [{ documentAssetId: PDF }, false],
    [null, false],
  ])('reads %o as %s', (raw, expected) => {
    expect(linkedInConfigIsDocument(raw)).toBe(expected);
  });
});
