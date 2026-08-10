// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Server-side feature flags.
 *
 * The existing `feature-flag.service.ts` is the OpenFeature **Web** SDK: it runs in the
 * browser and returns Angular `Signal<T>`, so it cannot gate an Express handler. This
 * helper covers the server side only, and deliberately stays small — it exists so the
 * campaign-service cutover can move one endpoint at a time and roll a bad one back by
 * changing an environment variable, without shipping code.
 *
 * Be precise about what that buys, because "env var" reads as "instant" and it is not. The
 * chart injects these as container environment variables, so changing one edits the Deployment
 * pod template and reaches a process only through a rolling restart. What is avoided is a code
 * change, a build and an image promotion — not a rollout. Plan for the rollout: with the
 * default three replicas and a RollingUpdate, flag-on and flag-off pods overlap for its
 * duration. That overlap is harmless HERE only because routing also depends on the job id's
 * shape (`isCampaignServiceJobId`): a `job_` id goes to the in-process map on every pod
 * regardless of the flag, and a UUID cannot exist until creation is cut over. A future flag
 * whose two paths can both claim the same request needs a no-overlap rollout, or a runtime
 * configuration source every replica observes at once.
 *
 * Env vars are read on EVERY call rather than captured at module load. This buys NOTHING
 * operationally and the reason is worth stating, because per-request reads look like they
 * should: a running process's environment cannot be changed from outside. `kubectl set env`
 * patches the Deployment template and replaces pods; it does not reach into a live container.
 * So a per-call read and a module-load read behave identically in the cluster. The reason to
 * read per call is testability — a value frozen at import time cannot be varied across cases
 * without module-registry surgery — plus keeping the door open for a future dynamic source
 * that mutates `process.env` in-process. The cost is a map lookup per request, which is
 * nothing next to the HTTP call it gates.
 */

/** Every server-side flag, and what turning it ON does. */
export enum ServerFeatureFlag {
  /**
   * Serve `GET /api/campaigns/jobs/:jobId` from lfx-v2-campaign-service instead of the
   * in-process job map in `campaign-proxy.service.ts`. OFF keeps the current behaviour
   * byte-for-byte.
   */
  CampaignServiceJobs = 'LFX_CUTOVER_CAMPAIGN_SERVICE_JOBS',
}

/**
 * True only for an explicit affirmative value. Everything else — unset, empty, `0`,
 * `false`, or a typo — is OFF.
 *
 * Default-deny is the whole safety property here. If an unrecognised value defaulted to ON,
 * `LFX_CUTOVER_CAMPAIGN_SERVICE_JOBS=flase` would silently route production traffic at a
 * service the operator believed was still dark, and the misspelling is invisible in a
 * values.yaml diff. A typo must fail towards the path that is already known to work.
 */
export function isServerFeatureEnabled(flag: ServerFeatureFlag): boolean {
  const raw = process.env[flag];
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
