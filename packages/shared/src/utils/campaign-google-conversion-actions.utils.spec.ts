// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { GoogleAdsConversionActionOption } from '../interfaces/campaign.interface';
import {
  googleConversionActionLabel,
  googleConversionActionsTextWithPicked,
  googlePickedConversionActionIds,
} from './campaign-google-conversion-actions.utils';

const action = (id: string, overrides: Partial<GoogleAdsConversionActionOption> = {}): GoogleAdsConversionActionOption => ({
  id,
  resourceName: `customers/1234567890/conversionActions/${id}`,
  name: `Action ${id}`,
  category: 'SIGNUP',
  primaryForGoal: false,
  ...overrides,
});
const ACTIONS = [action('111'), action('222'), action('333')];

describe('googlePickedConversionActionIds', () => {
  it('reads the listed actions the text names, by id or resource name, in list order', () => {
    expect(googlePickedConversionActionIds(' 333 \n\ncustomers/1234567890/conversionActions/111\n999', ACTIONS)).toEqual(['111', '333']);
    expect(googlePickedConversionActionIds('', ACTIONS)).toEqual([]);
  });
});

describe('googleConversionActionsTextWithPicked', () => {
  it('writes picked actions as ids in list order, then every other typed line as it was', () => {
    expect(googleConversionActionsTextWithPicked('999\n', ['333', '111'], ACTIONS)).toBe('111\n333\n999');
  });

  it('keeps the spelling a picked action was already typed in', () => {
    expect(googleConversionActionsTextWithPicked('customers/1234567890/conversionActions/222', ['222', '111'], ACTIONS)).toBe(
      '111\ncustomers/1234567890/conversionActions/222'
    );
  });

  it('removes an unpicked listed action and leaves the text unchanged when the picks are unchanged', () => {
    expect(googleConversionActionsTextWithPicked('111\n222\n999', ['222'], ACTIONS)).toBe('222\n999');
    expect(googleConversionActionsTextWithPicked('111\n999', ['111'], ACTIONS)).toBe('111\n999');
  });
});

describe('googleConversionActionLabel', () => {
  it('shows the name, the category in words and whether the action is primary', () => {
    expect(googleConversionActionLabel(action('1', { name: 'Event Registrations', category: 'SUBMIT_LEAD_FORM', primaryForGoal: true }))).toBe(
      'Event Registrations · Submit lead form · Primary'
    );
    expect(googleConversionActionLabel(action('2', { name: 'Upload', category: '' }))).toBe('Upload');
  });
});
