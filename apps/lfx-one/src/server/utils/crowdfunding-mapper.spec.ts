// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { BackendInitiative } from '../types/crowdfunding.types';
import { mapToInitiativeBase, mapToInitiativeDetail } from './crowdfunding-mapper';

function backend(overrides: Partial<BackendInitiative> = {}): BackendInitiative {
  return {
    id: 'synthetic-initiative-1',
    initiative_type: 'general_fund',
    owner_id: 'synthetic-owner',
    name: 'Synthetic Initiative',
    slug: 'synthetic-initiative',
    status: 'published',
    created_on: '2026-01-01T00:00:00Z',
    updated_on: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('crowdfunding mapper creator (lfx-crowdfunding#452)', () => {
  it('maps the creator CF sends on the lens list and the manage read', () => {
    expect(mapToInitiativeBase(backend({ creator: 'Synthetic Owner' })).creator).toBe('Synthetic Owner');
    expect(mapToInitiativeDetail(backend({ creator: 'Synthetic Owner' })).creator).toBe('Synthetic Owner');
  });

  it('leaves the creator unset when CF omits it or sends it blank', () => {
    expect(mapToInitiativeBase(backend()).creator).toBeUndefined();
    expect(mapToInitiativeBase(backend({ creator: '' })).creator).toBeUndefined();
  });
});
