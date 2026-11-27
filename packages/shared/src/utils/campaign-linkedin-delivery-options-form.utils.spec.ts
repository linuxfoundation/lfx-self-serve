// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  emptyLinkedInDeliveryOptionsDraft,
  linkedInAudienceNetworkOffered,
  linkedInDeliveryOptionsCreateRefusal,
  linkedInDeliveryOptionsDraftFromStored,
  linkedInDeliveryOptionsForCreate,
  linkedInDeliveryOptionDisabled,
  linkedInDeliveryOptionsShown,
} from './campaign-linkedin-delivery-options-form.utils';
import { linkedInDeliveryOptionsRefusal } from './campaign-linkedin-delivery-options.utils';

const OFF = emptyLinkedInDeliveryOptionsDraft();
const BOTH = { audienceExpansion: true, audienceNetwork: true };

describe('linkedInDeliveryOptionsShown', () => {
  it.each([
    ['on an explicit yes', OFF, true, true, true],
    ['not while off', BOTH, false, true, false],
    ['not while unread with both off', OFF, null, true, false],
    ['while unread with a toggle on, so it can be turned off', { ...OFF, audienceNetwork: true }, null, true, true],
    ['on an explicit yes, with the Audience Network not offered', BOTH, true, false, true],
    ['not while unread with only an Audience Network that is not offered', { ...OFF, audienceNetwork: true }, null, false, false],
  ])('%s', (_name, draft, enabled, networkOffered, expected) => {
    expect(linkedInDeliveryOptionsShown(draft, enabled, networkOffered)).toBe(expected);
  });
});

describe('linkedInDeliveryOptionDisabled', () => {
  it.each([
    ['an unchecked option where opt-in is allowed', false, true, false],
    ['an unchecked option where opt-in is blocked', false, false, true],
    // A held or unsendable choice can always be cleared.
    ['a checked option where opt-in is blocked', true, false, false],
    ['a checked option where opt-in is allowed', true, true, false],
  ])('%s', (_name, checked, optInAllowed, expected) => {
    expect(linkedInDeliveryOptionDisabled(checked, optInAllowed)).toBe(expected);
  });
});

describe('linkedInAudienceNetworkOffered', () => {
  it.each([
    [false, false, true],
    [true, false, false],
    [false, true, false],
  ])('text ads %s, lead gen %s: %s', (textAds, leadGen, expected) => {
    expect(linkedInAudienceNetworkOffered(textAds, leadGen)).toBe(expected);
  });
});

describe('linkedInDeliveryOptionsForCreate', () => {
  it.each([
    ['nothing with both off', OFF, true, true, {}],
    ['both on', BOTH, true, true, { audienceExpansionEnabled: true, offsiteDeliveryEnabled: true }],
    ['only Audience Expansion while the Audience Network is not offered', BOTH, true, false, { audienceExpansionEnabled: true }],
    ['nothing while the capability is off', BOTH, false, true, {}],
    ['nothing while the capability is unread', BOTH, null, true, {}],
  ])('sends %s', (_name, draft, enabled, networkOffered, expected) => {
    const fields = linkedInDeliveryOptionsForCreate(draft, enabled, networkOffered);
    expect(fields).toEqual(expected);
    // Whatever the tab sends, the create route accepts on a deployment with the options on.
    expect(linkedInDeliveryOptionsRefusal({ ...fields, ...(networkOffered ? {} : { format: 'text' }) }, true)).toBeNull();
  });
});

describe('linkedInDeliveryOptionsCreateRefusal', () => {
  it.each([
    ['a toggle on while unread', { ...OFF, audienceExpansion: true }, null, "can't be confirmed yet"],
    ['both off while unread', OFF, null, null],
    ['a toggle on while offered', BOTH, true, null],
    ['a toggle on while off: hidden and not sent', BOTH, false, null],
    // Not offered (text ads or lead generation), the Audience Network is never sent, so it holds nothing.
    ['only an Audience Network that is not offered, while unread', { ...OFF, audienceNetwork: true }, null, null, false],
    ['Audience Expansion beside a network that is not offered, while unread', BOTH, null, "can't be confirmed yet", false],
  ])('%s', (_name, draft, enabled, expected, networkOffered = true) => {
    const refusal = linkedInDeliveryOptionsCreateRefusal(draft, enabled, networkOffered);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
  });
});

describe('linkedInDeliveryOptionsDraftFromStored', () => {
  it.each([
    ['both toggles', BOTH, BOTH],
    ['a toggle that is not a boolean as off', { audienceExpansion: 'true', audienceNetwork: true }, { audienceExpansion: false, audienceNetwork: true }],
    ['an empty record as both off', {}, OFF],
    ['nothing from a value that is not a record', [true], null],
    ['nothing when absent', undefined, null],
  ])('restores %s', (_name, stored, expected) => {
    expect(linkedInDeliveryOptionsDraftFromStored(stored)).toEqual(expected);
  });
});
