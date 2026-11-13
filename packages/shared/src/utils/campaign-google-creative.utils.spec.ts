// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  GOOGLE_CHANNELS_WITH_CREATIVE,
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_REQUEST_KEYS,
  GOOGLE_DEMAND_GEN_VIDEO_REQUEST_KEY,
  GOOGLE_SHARED_CALLS_TO_ACTION,
} from '../constants/campaign.constants';
import type { GoogleCreativeFieldSpec } from '../interfaces/campaign.interface';
import {
  GOOGLE_CREATIVE_WIRE_FIELDS,
  GOOGLE_DEMAND_GEN_VIDEO_WIRE_FIELDS,
  googleCallToActionRefusal,
  googleCreativeFieldWidth,
  googleCreativeImageFit,
  googleCreativeImageRequirement,
  googlePerformanceMaxSearchThemesRefusal,
  googlePerformanceMaxShortDescriptionMissing,
  storedCreativeAssetLabel,
} from './campaign-google-creative.utils';

const LANDSCAPE = { ratioW: 191, ratioH: 100, minWidth: 600, minHeight: 314 };
const SQUARE_LOGO = { ratioW: 1, ratioH: 1, minWidth: 128, minHeight: 128 };

describe('googleCreativeImageFit', () => {
  it('accepts an image on the ratio and at the minimum size', () => {
    expect(googleCreativeImageFit({ width: 1200, height: 628 }, LANDSCAPE)).toBe('fits');
    expect(googleCreativeImageFit({ width: 600, height: 314 }, LANDSCAPE)).toBe('fits');
  });

  /** ±1% on the ratio, measured against the target, as `ShapeRule.ratioDrift` measures it. */
  it('holds the ratio to within one percent', () => {
    expect(googleCreativeImageFit({ width: 1000, height: 1009 }, SQUARE_LOGO)).toBe('fits');
    expect(googleCreativeImageFit({ width: 1000, height: 1020 }, SQUARE_LOGO)).toBe('misfit');
  });

  it('refuses an image below either minimum even on the exact ratio', () => {
    expect(googleCreativeImageFit({ width: 382, height: 200 }, LANDSCAPE)).toBe('misfit');
    expect(googleCreativeImageFit({ width: 127, height: 127 }, SQUARE_LOGO)).toBe('misfit');
  });

  /** campaign-service holds at most 5 MiB per Google image, whatever its shape. */
  it('refuses an image over the Google byte cap even on the exact shape', () => {
    expect(googleCreativeImageFit({ width: 1200, height: 628, byteSize: 5 * 1024 * 1024 }, LANDSCAPE)).toBe('fits');
    expect(googleCreativeImageFit({ width: 1200, height: 628, byteSize: 5 * 1024 * 1024 + 1 }, LANDSCAPE)).toBe('misfit');
    expect(googleCreativeImageFit({ byteSize: 6 * 1024 * 1024 }, LANDSCAPE)).toBe('misfit');
  });

  /** Absent dimensions mean NOT MEASURED (an asset stored before they were recorded), never 0x0. */
  it('reports an image with no recorded dimensions as unknown', () => {
    expect(googleCreativeImageFit({}, LANDSCAPE)).toBe('unknown');
    expect(googleCreativeImageFit({ width: 1200 }, LANDSCAPE)).toBe('unknown');
  });
});

describe('googleCreativeImageRequirement', () => {
  it('states the ratio, its tolerance and the minimum size', () => {
    expect(googleCreativeImageRequirement(LANDSCAPE)).toBe('1.91:1 (within 1%), at least 600x314 px, up to 5 MB');
    expect(googleCreativeImageRequirement({ ratioW: 9, ratioH: 16, minWidth: 600, minHeight: 1067 })).toBe(
      '9:16 (within 1%), at least 600x1067 px, up to 5 MB'
    );
  });
});

describe('storedCreativeAssetLabel', () => {
  it('names the size, the type and the head of the id', () => {
    expect(storedCreativeAssetLabel({ id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', mimeType: 'image/png', width: 1200, height: 628 })).toBe(
      '1200x628 PNG · 3f2504e0'
    );
    expect(storedCreativeAssetLabel({ id: 'abcdef12-0000', mimeType: 'image/jpeg' })).toBe('Size unknown JPEG · abcdef12');
  });
});

/**
 * Pins the catalogue's image shapes to campaign-service's slot tables (`demandGenImageSlots`,
 * `performanceMaxImageSlots`, `displayImageSlots`), so an edit here cannot drift from them quietly.
 */
describe('GOOGLE_CREATIVE_FIELD_SPECS image shapes', () => {
  const shapes = (channel: (typeof GOOGLE_CHANNELS_WITH_CREATIVE)[number]): Record<string, GoogleCreativeFieldSpec['image']> =>
    Object.fromEntries((GOOGLE_CREATIVE_FIELD_SPECS[channel] as readonly GoogleCreativeFieldSpec[]).filter((f) => f.image).map((f) => [f.control, f.image]));

  it('carries every image slot, and only image slots', () => {
    expect(Object.keys(shapes('demand-gen'))).toEqual(['marketingImages', 'squareMarketingImages', 'portraitImages', 'tallPortraitImages', 'logoImages']);
    expect(Object.keys(shapes('performance-max'))).toEqual(['marketingImages', 'squareMarketingImages', 'portraitImages', 'logoImages', 'landscapeLogoImages']);
    expect(Object.keys(shapes('display'))).toEqual(['marketingImages', 'squareMarketingImages', 'logoImages', 'squareLogoImages']);
  });

  /** The one trap the shared names hide: Display's logo is 4:1, the other channels' are square. */
  it("gives display's logoImages the 4:1 landscape shape and the other channels' a square one", () => {
    expect(shapes('display')['logoImages']).toEqual({ ratioW: 4, ratioH: 1, minWidth: 512, minHeight: 128 });
    expect(shapes('demand-gen')['logoImages']).toEqual(SQUARE_LOGO);
    expect(shapes('performance-max')['logoImages']).toEqual(SQUARE_LOGO);
    expect(shapes('demand-gen')['tallPortraitImages']).toEqual({ ratioW: 9, ratioH: 16, minWidth: 600, minHeight: 1067 });
  });
});

describe('googlePerformanceMaxSearchThemesRefusal', () => {
  const themes = (n: number): string[] => Array.from({ length: n }, (_, i) => `theme ${i + 1}`);

  it('accepts no themes, and 50 distinct ones, the probe-verified ceiling', () => {
    expect(googlePerformanceMaxSearchThemesRefusal([])).toBeNull();
    expect(googlePerformanceMaxSearchThemesRefusal(themes(50))).toBeNull();
  });

  it('refuses a 51st theme on the submitted count, before judging any entry', () => {
    expect(googlePerformanceMaxSearchThemesRefusal([...themes(50), ''])).toContain('at most 50 search themes');
  });

  it('refuses a blank entry by its position', () => {
    expect(googlePerformanceMaxSearchThemesRefusal(['kubernetes', ''])).toContain('blank entry (search theme 2)');
  });

  it('bounds a theme at 80 runes, counting code points rather than UTF-16 units', () => {
    expect(googlePerformanceMaxSearchThemesRefusal(['x'.repeat(80)])).toBeNull();
    expect(googlePerformanceMaxSearchThemesRefusal(['x'.repeat(81)])).toContain('has 81');
    // 80 astral-plane characters are 160 UTF-16 units but 80 runes, which upstream accepts.
    expect(googlePerformanceMaxSearchThemesRefusal(['😀'.repeat(80)])).toBeNull();
  });

  it('refuses a repeat case-folded with Go rules, rather than collapsing it', () => {
    expect(googlePerformanceMaxSearchThemesRefusal(['Cloud Native', 'cloud native'])).toContain('more than once');
    expect(googlePerformanceMaxSearchThemesRefusal(['ΟΔΟΣ', 'οδοσ'])).toContain('more than once');
  });

  it('names the first bad entry in list order', () => {
    expect(googlePerformanceMaxSearchThemesRefusal(['a', 'A', 'x'.repeat(81)])).toContain('more than once');
  });
});

describe('googlePerformanceMaxShortDescriptionMissing', () => {
  const long = 'Join KeycloakCon on March 15, 2027 in Barcelona. Half-day conference for IAM professionals';

  it('holds a list whose every description is wider than 60, and releases it at exactly 60', () => {
    expect(googlePerformanceMaxShortDescriptionMissing([long, 'x'.repeat(61)])).toBe(true);
    expect(googlePerformanceMaxShortDescriptionMissing([long, 'x'.repeat(60)])).toBe(false);
  });

  it('counts CJK and full-width characters double, as campaign-service does', () => {
    // 31 ideographs are 31 code points but a display width of 62.
    expect(googlePerformanceMaxShortDescriptionMissing([long, '会'.repeat(31)])).toBe(true);
    expect(googlePerformanceMaxShortDescriptionMissing([long, '会'.repeat(30)])).toBe(false);
  });

  it('measures the trimmed line and skips blank lines and non-strings', () => {
    expect(googlePerformanceMaxShortDescriptionMissing([long, `  ${'x'.repeat(60)}  `])).toBe(false);
    expect(googlePerformanceMaxShortDescriptionMissing([long, '   ', 42])).toBe(true);
  });

  it('judges nothing when no description is present', () => {
    expect(googlePerformanceMaxShortDescriptionMissing([])).toBe(false);
    expect(googlePerformanceMaxShortDescriptionMissing(['', '  '])).toBe(false);
    expect(googlePerformanceMaxShortDescriptionMissing(undefined)).toBe(false);
    expect(googlePerformanceMaxShortDescriptionMissing('short')).toBe(false);
  });
});

describe('googleCreativeFieldWidth', () => {
  it('counts a CJK ideograph twice on the fields campaign-service bounds by display width', () => {
    for (const control of ['headlines', 'longHeadlines', 'longHeadline', 'descriptions', 'businessName']) {
      expect(googleCreativeFieldWidth(control, '会会a')).toBe(5);
    }
  });

  it('counts runes on the call to action, asset group name and display paths', () => {
    for (const control of ['callToActionText', 'assetGroupName', 'path1', 'path2']) {
      expect(googleCreativeFieldWidth(control, '会会a')).toBe(3);
    }
  });

  it('counts an emoji once in both regimes, as campaign-service does', () => {
    expect(googleCreativeFieldWidth('headlines', '\u{1F600}\u{1F600}')).toBe(2);
    expect(googleCreativeFieldWidth('callToActionText', '\u{1F600}\u{1F600}')).toBe(2);
  });

  /** Every catalogue field with a width is measured by one of the two regimes upstream uses for it. */
  it('treats every rune-counted catalogue control as a real catalogue field', () => {
    const controls = new Set<string>(
      Object.values(GOOGLE_CREATIVE_FIELD_SPECS).flatMap((specs) => (specs as readonly GoogleCreativeFieldSpec[]).map((spec) => spec.control))
    );
    for (const control of ['callToActionText', 'assetGroupName', 'path1', 'path2']) {
      expect(controls.has(control)).toBe(true);
    }
  });
});

describe('the creative wire tables', () => {
  it("give each creative channel its request key and the catalogue's list, image and scalar fields", () => {
    for (const channel of GOOGLE_CHANNELS_WITH_CREATIVE) {
      const wire = GOOGLE_CREATIVE_WIRE_FIELDS[channel];
      const fields: readonly GoogleCreativeFieldSpec[] = GOOGLE_CREATIVE_FIELD_SPECS[channel];
      expect(wire.key).toBe(GOOGLE_CREATIVE_REQUEST_KEYS[channel]);
      expect(wire.lists).toEqual(fields.filter((f) => f.kind === 'list').map((f) => f.control));
      expect(wire.scalars).toEqual(fields.filter((f) => f.kind === 'text').map((f) => f.control));
    }
    // Display's long headline is a scalar where Performance Max's long headlines are a list.
    expect(GOOGLE_CREATIVE_WIRE_FIELDS['display'].scalars).toContain('longHeadline');
    expect(GOOGLE_CREATIVE_WIRE_FIELDS['performance-max'].lists).toContain('longHeadlines');
  });

  it('keep the Demand Gen video ad under its own key, with its logo the only image slot', () => {
    expect(GOOGLE_DEMAND_GEN_VIDEO_WIRE_FIELDS.key).toBe(GOOGLE_DEMAND_GEN_VIDEO_REQUEST_KEY);
    expect(GOOGLE_DEMAND_GEN_VIDEO_WIRE_FIELDS.images).toEqual(['logoImages']);
    expect(GOOGLE_DEMAND_GEN_VIDEO_WIRE_FIELDS.lists).toContain('youtubeVideoIds');
    expect(Object.values(GOOGLE_CREATIVE_WIRE_FIELDS).map((w) => w.key)).not.toContain(GOOGLE_DEMAND_GEN_VIDEO_REQUEST_KEY);
  });
});

describe('googleCallToActionRefusal (#1614, F13)', () => {
  it('passes a listed Display call to action, and none', () => {
    expect(googleCallToActionRefusal({ displayCreative: { callToActionText: 'Learn More' } }, 'display')).toBeNull();
    expect(googleCallToActionRefusal({ displayCreative: { callToActionText: '  ' } }, 'display')).toBeNull();
    expect(googleCallToActionRefusal({ displayCreative: { headlines: ['Join us'] } }, 'display')).toBeNull();
  });

  it('refuses an unlisted Display call to action, on the single ad and in a named ad group', () => {
    expect(googleCallToActionRefusal({ displayCreative: { callToActionText: 'Register' } }, 'display')?.message).toContain('does not accept "Register"');
    expect(googleCallToActionRefusal({ displayAdGroups: [{ name: 'A', creative: { callToActionText: 'Register' } }] }, 'display')?.message).toContain(
      'Register'
    );
  });

  it('passes a Demand Gen image call to action Google accepted, and refuses one it refused', () => {
    expect(googleCallToActionRefusal({ demandGenCreative: { callToActionText: 'Learn More' } }, 'demand-gen')).toBeNull();
    expect(googleCallToActionRefusal({ demandGenCreative: { callToActionText: 'Donate Now' } }, 'demand-gen')).toBeNull();
    expect(googleCallToActionRefusal({ demandGenCreative: { callToActionText: 'Register' } }, 'demand-gen')?.message).toContain('"Register"');
  });

  it('offers the brief generator only calls to action both ads accept', () => {
    expect(GOOGLE_SHARED_CALLS_TO_ACTION.map((option) => option.value)).toEqual([
      'Apply Now',
      'Book Now',
      'Call Now',
      'Contact Us',
      'Download',
      'Get Offer',
      'Get Quote',
      'Learn More',
      'See More',
      'Shop Now',
      'Sign Up',
      'Subscribe',
      'Visit Site',
    ]);
  });

  it('keeps the Display and Demand Gen image lists apart, as the 13 November probe found them', () => {
    // Accepted on Display only.
    for (const value of ['Install', 'Explore', 'Read More', 'Order Now', 'Try now']) {
      expect(googleCallToActionRefusal({ displayCreative: { callToActionText: value } }, 'display')).toBeNull();
      expect(googleCallToActionRefusal({ demandGenCreative: { callToActionText: value } }, 'demand-gen')).not.toBeNull();
    }
    // Accepted on Demand Gen only.
    expect(googleCallToActionRefusal({ demandGenCreative: { callToActionText: 'Donate Now' } }, 'demand-gen')).toBeNull();
    expect(googleCallToActionRefusal({ displayCreative: { callToActionText: 'Donate Now' } }, 'display')).not.toBeNull();
    // Google refused the title-case spelling of this one on Display.
    expect(googleCallToActionRefusal({ displayCreative: { callToActionText: 'Try Now' } }, 'display')).not.toBeNull();
    // Refused on both.
    for (const value of ['Register', 'Get Started', 'Watch Now', 'Buy Tickets', 'Join Now']) {
      expect(googleCallToActionRefusal({ displayCreative: { callToActionText: value } }, 'display')).not.toBeNull();
      expect(googleCallToActionRefusal({ demandGenCreative: { callToActionText: value } }, 'demand-gen')).not.toBeNull();
    }
  });

  it('refuses an unlisted Demand Gen video call to action and passes a listed one', () => {
    expect(googleCallToActionRefusal({ demandGenVideoCreative: { callToAction: 'REGISTER' } }, 'demand-gen')?.message).toContain('REGISTER');
    expect(googleCallToActionRefusal({ demandGenVideoCreative: { callToAction: 'SIGN_UP' } }, 'demand-gen')).toBeNull();
  });

  it('reads several Demand Gen ads, named ad groups and their ads', () => {
    expect(googleCallToActionRefusal({ demandGenAds: [{ name: 'a', creative: { callToActionText: 'Go' } }] }, 'demand-gen')?.message).toContain('"Go"');
    expect(googleCallToActionRefusal({ demandGenAdGroups: [{ name: 'g', videoCreative: { callToAction: 'GET_STARTED' } }] }, 'demand-gen')?.message).toContain(
      'GET_STARTED'
    );
    expect(
      googleCallToActionRefusal({ demandGenAdGroups: [{ name: 'g', ads: [{ name: 'a', creative: { callToActionText: 'Go' } }] }] }, 'demand-gen')?.message
    ).toContain('"Go"');
  });

  it('names the field it refuses: callToActionText on the image and Display ads, callToAction on the video ad', () => {
    expect(googleCallToActionRefusal({ displayCreative: { callToActionText: 'Register' } }, 'display')?.field).toBe('callToActionText');
    expect(googleCallToActionRefusal({ demandGenCreative: { callToActionText: 'Register' } }, 'demand-gen')?.field).toBe('callToActionText');
    expect(googleCallToActionRefusal({ demandGenVideoCreative: { callToAction: 'REGISTER' } }, 'demand-gen')?.field).toBe('callToAction');
    expect(googleCallToActionRefusal({ demandGenAds: [{ name: 'a', videoCreative: { callToAction: 'REGISTER' } }] }, 'demand-gen')?.field).toBe('callToAction');
  });

  it('reads only the channel being created', () => {
    const body = { displayCreative: { callToActionText: 'Register' }, demandGenCreative: { callToActionText: 'Register' } };
    expect(googleCallToActionRefusal(body, 'performance-max')).toBeNull();
    expect(googleCallToActionRefusal(body, 'search')).toBeNull();
  });
});
