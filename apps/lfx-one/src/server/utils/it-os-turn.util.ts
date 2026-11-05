// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_SESSION_EVENTS_TRUNCATED, MKTG_SESSION_TURN_STARTED } from '@lfx-one/shared/constants';

/**
 * Whether the agent has finished its latest turn, from a session's raw event payloads (as returned by
 * GuildService.getRawEventPayloads, oldest first, with user messages reduced to a turn-started marker).
 *
 * A turn opens an outer `runtime_start` and closes it with a `runtime_done` (or `runtime_error`) after
 * the agent's last message; each tool call nests its own start and end in between. So the turn is over
 * when, since the latest user message, every start has an end and the newest event is an end. An interim
 * notification arrives while the outer runtime is still open, so it doesn't count as finished.
 * A truncated event page can't prove anything, so it counts as not finished.
 */
export function itOsTurnComplete(payloads: string[]): boolean {
  const types = payloads.map((payload) => {
    try {
      return (JSON.parse(payload) as { type?: string })?.type ?? '';
    } catch {
      return '';
    }
  });
  if (types.includes(MKTG_SESSION_EVENTS_TRUNCATED)) return false;

  const turn = types.slice(types.lastIndexOf(MKTG_SESSION_TURN_STARTED) + 1);
  const starts = turn.filter((type) => type === 'runtime_start').length;
  const ends = turn.filter((type) => type === 'runtime_done' || type === 'runtime_error').length;
  const last = [...turn].reverse().find((type) => type.startsWith('runtime_'));
  return starts > 0 && starts === ends && last !== 'runtime_start';
}
