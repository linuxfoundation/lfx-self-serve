// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isLinkedInTargetingSearchFacet, linkedInAudienceSegments, linkedInTargetingSearchEntities } from './campaign-linkedin-targeting-lookup.utils';

describe('isLinkedInTargetingSearchFacet', () => {
  it.each([
    ['skills', true],
    ['employers', true],
    ['locations', false],
    ['seniorities', false],
    ['constructor', false],
    [7, false],
  ])('%s → %s', (raw, expected) => {
    expect(isLinkedInTargetingSearchFacet(raw)).toBe(expected);
  });
});

describe('linkedInTargetingSearchEntities', () => {
  it('keeps the URNs the facet accepts, once, in order, named by name or URN', () => {
    expect(
      linkedInTargetingSearchEntities('skills', [
        { urn: 'urn:li:skill:17', name: ' Kubernetes ' },
        { urn: 'urn:li:skill:17', name: 'Repeat' },
        { urn: 'urn:li:title:1', name: 'Wrong facet' },
        { urn: 'urn:li:skill:01', name: 'Leading zero' },
        { urn: 'urn:li:skill:5', name: '' },
        null,
        'x',
      ])
    ).toEqual([
      { urn: 'urn:li:skill:17', name: 'Kubernetes' },
      { urn: 'urn:li:skill:5', name: 'urn:li:skill:5' },
    ]);
  });

  it('takes both employer namespaces', () => {
    expect(linkedInTargetingSearchEntities('employers', [{ urn: 'urn:li:organization:1' }, { urn: 'urn:li:company:2' }]).map((e) => e.urn)).toEqual([
      'urn:li:organization:1',
      'urn:li:company:2',
    ]);
  });

  it('reads anything but a list as nothing', () => {
    expect(linkedInTargetingSearchEntities('skills', { urn: 'urn:li:skill:1' })).toEqual([]);
  });
});

describe('linkedInAudienceSegments', () => {
  it('keeps segments with a targeting facet and a valid URN, once, camel-cased', () => {
    expect(
      linkedInAudienceSegments([
        {
          id: '11',
          urn: 'urn:li:adSegment:11',
          name: 'Contacts',
          type: 'BULK',
          status: 'READY',
          facet: 'audienceMatchingSegments',
          approximate_member_count: 3000,
        },
        { id: '11', urn: 'urn:li:adSegment:11', name: 'Repeat', type: 'BULK', status: 'READY', facet: 'audienceMatchingSegments' },
        { id: '12', urn: 'urn:li:adSegment:12', name: '', type: 'RETARGETING', status: 'BUILDING', facet: 'dynamicSegments', approximate_member_count: -1 },
        { id: '13', urn: 'urn:li:adSegment:13', name: 'No facet', type: 'LOOKALIKE', status: 'READY' },
        { id: '14', urn: 'urn:li:adSegment:x', name: 'Bad URN', type: 'BULK', status: 'READY', facet: 'audienceMatchingSegments' },
        { id: '15', urn: 'urn:li:adSegment:15', name: 'Other facet', type: 'BULK', status: 'READY', facet: 'skills' },
      ])
    ).toEqual([
      { urn: 'urn:li:adSegment:11', name: 'Contacts', facet: 'audienceMatchingSegments', type: 'BULK', status: 'READY', approximateMemberCount: 3000 },
      {
        urn: 'urn:li:adSegment:12',
        name: 'urn:li:adSegment:12',
        facet: 'dynamicSegments',
        type: 'RETARGETING',
        status: 'BUILDING',
        approximateMemberCount: null,
      },
    ]);
  });

  it('reads anything but a list as nothing', () => {
    expect(linkedInAudienceSegments(null)).toEqual([]);
  });
});
