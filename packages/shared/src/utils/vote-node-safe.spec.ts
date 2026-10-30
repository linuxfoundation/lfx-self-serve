// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { PollStatus } from '../enums/poll.enum';
import type { Vote } from '../interfaces/poll.interface';

// Plain Node, no Angular setup: loading either module must never reach Angular or date-fns. Both are mocked to throw on import.
vi.mock('@angular/forms', () => {
  throw new Error('@angular/forms must not be imported by the Node-safe vote utils');
});
vi.mock('date-fns', () => {
  throw new Error('date-fns must not be imported by the Node-safe vote utils');
});

const NODE_SAFE_FILES = ['vote-participation.utils.ts', 'vote-results.utils.ts'];

describe('Node-safe vote utils', () => {
  it('load without @angular/forms or date-fns', async () => {
    const participation = await import('./vote-participation.utils');
    const results = await import('./vote-results.utils');

    const vote: Vote = {
      uid: 'vote-uid',
      name: 'Node-safe vote',
      project_uid: 'project-uid',
      status: PollStatus.ACTIVE,
      end_time: '2026-06-01T00:00:00Z',
      num_response_received: 1,
      total_voting_request_invitations: 2,
    };

    expect(participation.computeVoteRowParticipation(vote).percent).toBe(50);
    expect(results.votePermalinkPath('abc')).toBe('/votes/abc');
  });

  it.each(NODE_SAFE_FILES)('%s has no @angular or date-fns import', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    expect(source).not.toMatch(/from\s+['"](@angular\/|date-fns)/);
  });
});
