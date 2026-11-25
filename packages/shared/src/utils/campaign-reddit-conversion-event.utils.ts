// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_REDDIT_CONVERSION_EVENT,
  DEFAULT_REDDIT_OBJECTIVE,
  REDDIT_CONVERSION_EVENT_FIELD,
  REDDIT_CONVERSION_EVENTS,
  REDDIT_OBJECTIVE_LABELS,
} from '../constants/campaign.constants';
import type {
  CampaignBiddingCapabilityBlock,
  CampaignCapabilityReadState,
  RedditConfigRefusal,
  RedditConversionEvent,
  RedditObjective,
} from '../interfaces/campaign.interface';
import { foldKey } from './campaign-linkedin-config.utils';
import { goTrimSpace } from './campaign-linkedin.utils';

/**
 * The Reddit conversion event (#6108 row 2), mirroring campaign-service's `checkRedditConversionEvent`
 * (`internal/dispatch/reddit_conversion_event.go`) and `ResolveConversionEvent` (`internal/platform/reddit/client.go`,
 * #549), so a create campaign-service would refuse is refused here first; and the Implement tab's picker rules.
 */

const KEY = 'conversionEvent';
const EVENT_LIST = REDDIT_CONVERSION_EVENTS.join(', ');

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isConversionEvent(value: unknown): value is RedditConversionEvent {
  return typeof value === 'string' && (REDDIT_CONVERSION_EVENTS as readonly string[]).includes(value);
}

/**
 * Why `raw`'s `conversionEvent` cannot be sent, or `null`. Typed runtime checks, since the create route forwards
 * `redditConfig` as it comes. In campaign-service's order: shape, then the flag, then the rules. Refused:
 *
 * - a case variant of the key (campaign-service decodes keys ignoring case, Unicode folds included: `foldKey`), whatever
 *   the flag;
 * - a value that is not text (`null` included), or blank text;
 * - the field while this deployment cannot send it (`enabled`): refused, never dropped, since the legacy creator
 *   ignores it and campaign-service refuses it while `REDDIT_CONVERSION_EVENT_ENABLED` is off;
 * - a value outside `REDDIT_CONVERSION_EVENTS` (trimmed as Go's `strings.TrimSpace` does, `goTrimSpace`, any case);
 * - an objective campaign-service does not know, or any objective but `conversions` (absent or empty is
 *   `conversions`, its default).
 *
 * Absent, nothing is checked. Messages never echo a caller value.
 */
export function redditConversionEventRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  const field = REDDIT_CONVERSION_EVENT_FIELD;
  if (Object.keys(config).some((key) => key !== KEY && foldKey(key) === foldKey(KEY))) {
    return { field, message: 'Send the conversion event as "conversionEvent", spelled exactly.' };
  }
  if (!(KEY in config)) return null;
  const event = config[KEY];
  if (typeof event !== 'string') {
    return { field, message: `The conversion event must be text naming a pixel event, one of ${EVENT_LIST}. Omit it for the default, PURCHASE.` };
  }
  if (goTrimSpace(event) === '') return { field, message: 'An empty conversion event is refused. Omit it for the default, PURCHASE.' };
  // campaign-service decodes keys ignoring case, so a case variant of "objective" is the objective it checks the event
  // against; read only by its exact spelling here, it would look absent (conversions) and pass.
  if (Object.keys(config).some((key) => key !== 'objective' && foldKey(key) === 'objective')) {
    return { field, message: 'Send the objective as "objective", spelled exactly, with a conversion event.' };
  }
  if (!enabled) {
    return { field, message: 'Reddit conversion events are not enabled on this deployment. Reload the page and create again.' };
  }
  if (!isConversionEvent(goTrimSpace(event).toUpperCase())) return { field, message: `The conversion event must be one of ${EVENT_LIST}.` };
  const objective = config['objective'] ?? '';
  const resolved = objective === '' ? DEFAULT_REDDIT_OBJECTIVE : objective;
  if (typeof resolved !== 'string' || !Object.hasOwn(REDDIT_OBJECTIVE_LABELS, resolved)) {
    return { field, message: 'The conversion event needs a Reddit objective Reddit supports. Choose the conversions objective.' };
  }
  if (resolved !== 'conversions') {
    return { field, message: 'The conversion event applies to the conversions objective only. Omit it, or choose the conversions objective.' };
  }
  return null;
}

/** Whether the picker is offered: only on an explicit yes, and only for the conversions objective. */
export function redditConversionEventOffered(enabled: boolean | null, objective: RedditObjective): boolean {
  return enabled === true && objective === 'conversions';
}

/** `{ conversionEvent }` when a create sends it: offered, and other than the default (an absent field is PURCHASE). */
export function redditConversionEventField(
  event: RedditConversionEvent,
  objective: RedditObjective,
  enabled: boolean | null
): { conversionEvent?: RedditConversionEvent } {
  return redditConversionEventOffered(enabled, objective) && event !== DEFAULT_REDDIT_CONVERSION_EVENT ? { conversionEvent: event } : {};
}

/**
 * Why Create is held for a conversion event the draft holds but this deployment has not confirmed, or `null`.
 * Only a non-default event on the conversions objective is held: it changes what the campaign optimizes toward, so it
 * is never dropped. Only an explicit no (`unsupported`) offers Use Purchase; while the answer is out or failed, Create
 * waits or offers Retry, as `metaAdOptionsBlock` does.
 */
export function redditConversionEventBlock(
  event: RedditConversionEvent,
  objective: RedditObjective,
  enabled: boolean | null,
  createCapabilityRead: CampaignCapabilityReadState,
  briefId: string | null
): CampaignBiddingCapabilityBlock | null {
  if (objective !== 'conversions' || event === DEFAULT_REDDIT_CONVERSION_EVENT || enabled === true) return null;
  if (enabled === false) {
    return { kind: 'unsupported', message: 'This deployment cannot send the Reddit conversion event. Use Purchase to create the campaign.' };
  }
  if (createCapabilityRead === 'pending') {
    return { kind: 'pending', message: 'Checking whether the Reddit conversion event can be sent. Create waits so it is not dropped.' };
  }
  if (!briefId) {
    return { kind: 'unsaved', message: "The Reddit conversion event can't be checked until this brief is saved. Save the brief." };
  }
  return {
    kind: 'failed',
    message: 'Could not confirm that the Reddit conversion event can be sent, so Create waits rather than dropping it. Retry the check.',
  };
}

/** A stored draft value as the picker holds it: a known event, else `undefined` (the reset default stands). */
export function redditConversionEventFromDraft(value: unknown): RedditConversionEvent | undefined {
  return isConversionEvent(value) ? value : undefined;
}
