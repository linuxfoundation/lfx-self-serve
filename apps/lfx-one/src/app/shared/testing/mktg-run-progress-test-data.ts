// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgGenerateProgress, MktgRunAttempt, MktgStoredAgentRun } from '@lfx-one/shared/interfaces';

/** Fixtures must name the selected saved version explicitly, never infer it from cache order. */
export function mktgRunProgressFixture(
  type: 'document' | 'persisted',
  run: MktgStoredAgentRun | null,
  version: number,
  attempt?: MktgRunAttempt
): MktgGenerateProgress {
  const accepted = attempt ?? {
    session: { agentId: run?.agentId ?? 'synthetic-agent', sessionId: run?.sessionId ?? 'synthetic-session', ownerToken: run?.ownerToken ?? 'synthetic-proof' },
    runId: run?.runId,
    priorVersion: 0,
  };
  const documentLocation = run?.versions.find((entry) => entry.version === version)?.documentLocation ?? null;
  if (type === 'document') {
    if (!run) throw new Error('A document fixture needs a saved run.');
    return { type, run, documentLocation, attempt: accepted };
  }
  return { type, run, documentLocation, attempt: run ? accepted : null };
}
