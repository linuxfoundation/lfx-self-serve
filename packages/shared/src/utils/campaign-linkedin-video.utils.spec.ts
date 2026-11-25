// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInVideoRefusal } from './campaign-linkedin-video.utils';

const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const video = { introText: 'Join us', headline: 'KubeCon', videoAssetId: id };
const config = { eventName: 'KubeCon', variants: [video, { ...video, videoAssetId: id.toUpperCase() }] };

describe('linkedInVideoRefusal', () => {
  it.each([
    ['an image create', { variants: [{ introText: 'i', headline: 'h', imageAssetId: 'a1', description: 'd' }] }],
    ['blank video ids beside images', { variants: [{ introText: 'i', headline: 'h', imageUrn: 'urn:li:image:1', videoAssetId: ' ' }] }],
    ['a video create', config],
    ['a braced id', { variants: [{ ...video, videoAssetId: `{${id}}` }] }],
    ['a urn:uuid id', { variants: [{ ...video, videoAssetId: `URN:UUID:${id}` }] }],
    ['an id without dashes', { variants: [{ ...video, videoAssetId: id.replace(/-/g, '') }] }],
    ['an id with spaces around it', { variants: [{ ...video, videoAssetId: ` ${id}\n` }] }],
    ['blank images and description beside a video', { variants: [{ ...video, imageUrn: '', imageAssetId: null, description: '  ' }] }],
    ['a description that normalizes to nothing (a lone dash) beside a video', { variants: [{ ...video, description: '\u2014' }] }],
    ['a name and call to action beside a video', { variants: [{ ...video, name: 'Teaser', callToAction: 'REGISTER' }] }],
    ['variants that are not a list', { variants: 'none' }],
    ['not an object', null],
  ])('accepts %s', (_name, raw) => {
    expect(linkedInVideoRefusal(raw, true)).toBeNull();
  });

  it.each([
    ['a null video id', { variants: [{ ...video, videoAssetId: null }] }, 'linkedInConfig.variants[0].videoAssetId'],
    ['a number video id', { variants: [video, { ...video, videoAssetId: 7 }] }, 'linkedInConfig.variants[1].videoAssetId'],
    ['an id that is not a uuid', { variants: [{ ...video, videoAssetId: 'v1' }] }, 'linkedInConfig.variants[0].videoAssetId'],
    ['an id one digit short', { variants: [{ ...video, videoAssetId: id.slice(1) }] }, 'linkedInConfig.variants[0].videoAssetId'],
    ['a dash out of place', { variants: [{ ...video, videoAssetId: `${id.slice(0, 7)}-${id.slice(8)}` }] }, 'linkedInConfig.variants[0].videoAssetId'],
    ['an image URN beside a video', { variants: [{ ...video, imageUrn: 'urn:li:image:1' }] }, 'linkedInConfig.variants[0].videoAssetId'],
    ['an uploaded image beside a video', { variants: [video, { ...video, imageAssetId: id }] }, 'linkedInConfig.variants[1].videoAssetId'],
    ['a description beside a video', { variants: [{ ...video, description: 'Two days of talks' }] }, 'linkedInConfig.variants[0].description'],
    ['a video beside an image', { variants: [video, { introText: 'i', headline: 'h', imageAssetId: id }] }, 'linkedInConfig.variants'],
    ['a video beside a blank video id', { variants: [video, { ...video, videoAssetId: '' }] }, 'linkedInConfig.variants'],
    ['a video beside a variant that is not an object', { variants: [video, null] }, 'linkedInConfig.variants'],
  ])('refuses %s', (_name, raw, field) => {
    expect(linkedInVideoRefusal(raw, true)?.field).toBe(field);
  });

  it('refuses a video while this deployment cannot send one, naming the first, but not an image create', () => {
    expect(linkedInVideoRefusal({ variants: [{ introText: 'i', headline: 'h' }, video] }, false)?.field).toBe('linkedInConfig.variants[1].videoAssetId');
    expect(linkedInVideoRefusal({ variants: [{ introText: 'i', headline: 'h', imageAssetId: id }] }, false)).toBeNull();
  });

  it('checks the shape before the flag, and the flag before the rules', () => {
    expect(linkedInVideoRefusal({ variants: [{ ...video, videoAssetId: null }] }, false)?.message).toContain('must be the id');
    expect(linkedInVideoRefusal({ variants: [{ ...video, videoAssetId: 'v1' }] }, false)?.message).toContain('cannot create');
  });

  it('never echoes a caller value', () => {
    expect(linkedInVideoRefusal({ variants: [{ ...video, videoAssetId: 'SECRET' }] }, true)?.message).not.toContain('SECRET');
  });
});
