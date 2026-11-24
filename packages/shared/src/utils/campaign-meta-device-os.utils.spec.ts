// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { META_DEFAULT_PLACEMENTS, META_DEVICE_PLATFORM_OPTIONS, META_OS_FAMILY_OPTIONS } from '../constants/campaign.constants';
import type { CampaignCapabilityReadState, MetaDeviceOsDraft } from '../interfaces/campaign.interface';
import {
  copyMetaDeviceOsDraft,
  emptyMetaDeviceOsDraft,
  metaDeviceOsBlock,
  metaDeviceOsClearLabel,
  metaDeviceOsError,
  metaDeviceOsForCreate,
  metaDeviceOsFromDraft,
  metaDeviceOsSendable,
  metaDeviceOsWithValue,
} from './campaign-meta-device-os.utils';

const both: MetaDeviceOsDraft = { devicePlatforms: ['mobile'], userOs: ['iOS'] };

describe('the Implement tab device and OS rules', () => {
  it('starts empty, with fresh lists each time, and copies them', () => {
    expect(emptyMetaDeviceOsDraft()).toEqual({ devicePlatforms: [], userOs: [] });
    expect(emptyMetaDeviceOsDraft().userOs).not.toBe(emptyMetaDeviceOsDraft().userOs);
    const copy = copyMetaDeviceOsDraft(both);
    expect(copy).toEqual(both);
    expect(copy.devicePlatforms).not.toBe(both.devicePlatforms);
  });

  it.each([
    [[], 'desktop', true, META_DEVICE_PLATFORM_OPTIONS, ['desktop']],
    [['desktop'], 'mobile', true, META_DEVICE_PLATFORM_OPTIONS, ['mobile', 'desktop']],
    [['mobile', 'desktop'], 'mobile', false, META_DEVICE_PLATFORM_OPTIONS, ['desktop']],
    [['Android'], 'iOS', true, META_OS_FAMILY_OPTIONS, ['iOS', 'Android']],
    // A value the boxes do not offer (an older draft's) stays, after the offered ones.
    [['iOS_ver_9.0_and_above'], 'Android', true, META_OS_FAMILY_OPTIONS, ['Android', 'iOS_ver_9.0_and_above']],
  ])('ticks into %j %s = %s', (values, value, on, options, expected) => {
    expect(metaDeviceOsWithValue(values, value, on, options)).toEqual(expected);
  });

  it.each([
    ['a draft from before row 6', undefined, undefined, undefined],
    ['well-typed lists', ['mobile'], ['iOS'], both],
    // Refused but well typed: kept as saved, so the restored edit still shows its error and holds Create.
    ['desktop only with an OS', ['desktop'], ['Android'], { devicePlatforms: ['desktop'], userOs: ['Android'] }],
    ['one key only, de-duplicated', ['mobile', 'mobile'], undefined, { devicePlatforms: ['mobile'], userOs: [] }],
    ['the wrong types', 'mobile', [1], { devicePlatforms: [], userOs: [] }],
  ])('restores %s', (_name, devices, os, expected) => {
    expect(metaDeviceOsFromDraft(devices, os)).toEqual(expected);
  });

  it.each([
    [true, true, { devicePlatforms: ['mobile'], userOs: ['iOS'] }],
    [true, false, { devicePlatforms: ['mobile'] }],
    [null, true, { userOs: ['iOS'] }],
    [false, null, {}],
  ])('sends each list only on its own yes (device %s, os %s)', (device, os, expected) => {
    expect(metaDeviceOsForCreate(both, device, os)).toEqual(expected);
  });

  it('sends nothing for empty lists, even on a yes', () => {
    expect(metaDeviceOsForCreate(emptyMetaDeviceOsDraft(), true, true)).toEqual({});
  });

  it('clears only the lists answered no', () => {
    expect(metaDeviceOsSendable(both, false, null)).toEqual({ devicePlatforms: [], userOs: ['iOS'] });
    expect(metaDeviceOsSendable(both, true, false)).toEqual({ devicePlatforms: ['mobile'], userOs: [] });
  });

  const block = (
    draft: MetaDeviceOsDraft,
    deviceEnabled: boolean | null,
    osEnabled: boolean | null,
    createCapabilityRead: CampaignCapabilityReadState,
    briefId: string | null
  ) => metaDeviceOsBlock({ draft, deviceEnabled, osEnabled, createCapabilityRead, briefId })?.kind ?? null;

  it.each([
    ['nothing ticked, no answer', emptyMetaDeviceOsDraft(), null, null, 'pending', null, null],
    ['both answered yes', both, true, true, 'ready', 'b1', null],
    ['an unticked list whose flag is off', { devicePlatforms: ['mobile'], userOs: [] }, true, false, 'ready', 'b1', null],
    ['a ticked list answered no', both, true, false, 'pending', null, 'unsupported'],
    ['an answer still out', both, null, true, 'pending', 'b1', 'pending'],
    ['an unsaved brief', both, null, true, 'ready', null, 'unsaved'],
    ['a failed read', both, true, null, 'failed', 'b1', 'failed'],
  ] as [string, MetaDeviceOsDraft, boolean | null, boolean | null, CampaignCapabilityReadState, string | null, string | null][])(
    'holds Create for %s',
    (_name, draft, device, os, read, briefId, kind) => {
      expect(block(draft, device, os, read, briefId)).toBe(kind);
    }
  );

  it.each([
    [false, false, 'Clear the devices and operating systems'],
    [false, true, 'Clear the devices'],
    [true, false, 'Clear the operating systems'],
  ])('labels Clear for device %s, os %s', (device, os, label) => {
    expect(metaDeviceOsClearLabel(both, device, os)).toBe(label);
  });

  it.each([
    ['mobile with iOS', both, 'traffic', META_DEFAULT_PLACEMENTS, null],
    ['nothing ticked', emptyMetaDeviceOsDraft(), 'traffic', { ...META_DEFAULT_PLACEMENTS, audienceNetwork: true }, null],
    [
      'desktop only beside Audience Network',
      { devicePlatforms: ['desktop'], userOs: [] },
      'traffic',
      { ...META_DEFAULT_PLACEMENTS, audienceNetwork: true },
      'Audience Network',
    ],
    ['an OS with desktop only', { devicePlatforms: ['desktop'], userOs: ['Android'] }, 'awareness', META_DEFAULT_PLACEMENTS, 'desktop only'],
  ] as const)('checks %s with the create route rule', (_name, draft, objective, placements, fragment) => {
    const error = metaDeviceOsError({ devicePlatforms: [...draft.devicePlatforms], userOs: [...draft.userOs] }, objective, placements);
    if (fragment === null) expect(error).toBeNull();
    else expect(error).toContain(fragment);
  });
});
