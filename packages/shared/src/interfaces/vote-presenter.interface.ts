// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Vote } from './poll.interface';

/** Phases of the presenter view; `ended` renders the result state, everything else is a non-result state. */
export type VotePresenterPhase = 'loading' | 'active' | 'reconnecting' | 'ended' | 'empty' | 'error';

/** One successful poll: the vote payload plus when the browser received it (drives "Updated N seconds ago"). */
export interface VotePresenterSnapshot {
  vote: Vote;
  receivedAtMs: number;
}
