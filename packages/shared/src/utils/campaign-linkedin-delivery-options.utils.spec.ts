// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInConfigKeyRefusal } from './campaign-linkedin-config.utils';
import { linkedInDeliveryOptionsRefusal } from './campaign-linkedin-delivery-options.utils';

const EXPANSION = 'linkedInConfig.audienceExpansionEnabled';
const NETWORK = 'linkedInConfig.offsiteDeliveryEnabled';

describe('linkedInDeliveryOptionsRefusal', () => {
  it.each([
    ['neither option, on a deployment without them', { format: 'single_image', variants: [] }, false],
    // campaign-service reads null as omitted.
    ['null options, on a deployment without them', { audienceExpansionEnabled: null, offsiteDeliveryEnabled: null }, false],
    ['both on', { audienceExpansionEnabled: true, offsiteDeliveryEnabled: true }, true],
    ['both off', { audienceExpansionEnabled: false, offsiteDeliveryEnabled: false }, true],
    ['the Audience Network on a carousel', { format: 'carousel', offsiteDeliveryEnabled: true }, true],
    ['the Audience Network off on text ads', { format: 'text', offsiteDeliveryEnabled: false }, true],
    ['Audience Expansion on text ads', { format: 'text', audienceExpansionEnabled: true }, true],
    ['not an object', null, true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(linkedInDeliveryOptionsRefusal(raw, enabled)).toBeNull();
  });

  it.each([
    ['Audience Expansion without the flag', { audienceExpansionEnabled: true }, false, EXPANSION, 'cannot set'],
    ['Audience Expansion off without the flag', { audienceExpansionEnabled: false }, false, EXPANSION, 'cannot set'],
    ['the Audience Network off without the flag', { offsiteDeliveryEnabled: false }, false, NETWORK, 'cannot set'],
    ['Audience Expansion as text', { audienceExpansionEnabled: 'true' }, true, EXPANSION, 'true or false'],
    // The type is checked before the flag, as campaign-service does.
    ['the Audience Network as a number, without the flag', { offsiteDeliveryEnabled: 1 }, false, NETWORK, 'true or false'],
    ['the Audience Network on text ads', { format: 'text', offsiteDeliveryEnabled: true }, true, NETWORK, 'Sponsored Content only'],
  ])('refuses %s', (_name, raw, enabled, field, message) => {
    const refusal = linkedInDeliveryOptionsRefusal(raw, enabled);
    expect(refusal?.field).toBe(field);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes the caller value', () => {
    expect(linkedInDeliveryOptionsRefusal({ audienceExpansionEnabled: '<script>' }, true)?.message).not.toContain('<script>');
  });
});

describe('the delivery options and the key allow-list', () => {
  it('lets both options through spelled exactly, and names a differently cased one', () => {
    expect(linkedInConfigKeyRefusal({ audienceExpansionEnabled: true, offsiteDeliveryEnabled: false })).toBeNull();
    expect(linkedInConfigKeyRefusal({ OffsiteDeliveryEnabled: true })?.field).toBe(NETWORK);
  });
});
