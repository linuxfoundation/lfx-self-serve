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

/** Outcome of one poll attempt. `failures` counts consecutive failures so a caller can show "Reconnecting". */
export type VisibilityPollEvent<T> = { kind: 'ok'; value: T } | { kind: 'error'; error: unknown; failures: number };

/** Tuning for createVisibilityPoll. */
export interface VisibilityPollOptions<T> {
  /** Delay between a successful poll and the next. */
  intervalMs: number;
  /** First retry delay after a failure; doubles per consecutive failure. */
  backoffBaseMs: number;
  /** Ceiling for the retry delay. */
  backoffMaxMs: number;
  /** Returning false after a successful poll stops the loop until the tab next becomes visible. */
  shouldContinue?: (value: T) => boolean;
}

/** Result of exporting the vote slide PNG. */
export type VoteSlideExportResult = 'copied' | 'downloaded' | 'failed';

/** Turns the slide element into a PNG blob; injectable so tests need not run html-to-image in jsdom. */
export type VoteSlideRenderer = (element: HTMLElement) => Promise<Blob | null>;

/** The big count on the open state, split so the number can be set at display size. */
export interface VotePresenterCountParts {
  value: string;
  rest: string;
}

/** One option row of the result tally. */
export interface VotePresenterTallyRow {
  id: string;
  text: string;
  count: number;
  percent: number;
  barClass: string;
}

/** One question's tally on the result state. */
export interface VotePresenterTallyQuestion {
  questionId: string;
  question: string;
  rows: VotePresenterTallyRow[];
}

/** Rendering state of the client-generated QR: `pending` while the encoder loads, `failed` if it could not encode. */
export type VoteQrState = 'pending' | 'ready' | 'failed';
