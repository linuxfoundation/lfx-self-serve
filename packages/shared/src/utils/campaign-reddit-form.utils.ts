// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REDDIT_CALL_TO_ACTIONS, REDDIT_MAX_BUDGET_USD, REDDIT_SELECTABLE_OBJECTIVES, REDDIT_VIDEO_GOALS } from '../constants/campaign.constants';
import type { RedditCreateRefusalInput, RedditObjective, RedditVideoGoal } from '../interfaces/campaign.interface';

/**
 * The Implement tab's Reddit form rules (#5980): the budget, geo, subreddits, keywords, the Video Views goal and post,
 * stale objective and call to action, and why Create is held. One place for the rules, tested as table rows; the
 * component only wires its signals to them.
 */

/**
 * Reddit geo codes as a create sends them: trimmed, upper-cased, and only two-letter codes kept. An unassigned code like
 * "ZZ" still passes and is refused at dispatch (LFXV2-3316 covers a real ISO set).
 */
export function normaliseRedditGeoCodes(codes: readonly string[]): string[] {
  return codes.map((g) => g.trim().toUpperCase()).filter((g) => /^[A-Z]{2}$/.test(g));
}

/**
 * The geo targets a Reddit create carries: the brief's usable recommendation, else the form's country code. Normalised
 * FIRST, then the fallback chosen: a brief carrying an unusable `['USA']` is non-empty but filters to nothing, and must
 * not strand a valid country in the form.
 */
export function redditEffectiveGeoTargets(recommended: readonly string[], countryCode: string): string[] {
  const usable = normaliseRedditGeoCodes(recommended);
  return usable.length > 0 ? usable : normaliseRedditGeoCodes([countryCode]);
}

/** Subreddit names as they dispatch: an optional leading `r/` (or `/r/`) stripped, blanks dropped, so `r/k8s` previews as `r/k8s`, not `r/r/k8s`. */
export function redditEffectiveSubreddits(subreddits: readonly string[]): string[] {
  return subreddits.map((sub) => sub.trim().replace(/^\/?r\//i, '')).filter((sub) => sub.length > 0);
}

/** The keywords a Reddit create carries: its own, else the brief's generic keyword terms. */
export function redditEffectiveKeywords(redditKeywords: readonly string[], briefKeywordTerms: readonly string[]): string[] {
  return redditKeywords.length > 0 ? [...redditKeywords] : [...briefKeywordTerms];
}

/**
 * Whether the budget is one Reddit accepts. The ceiling and finiteness mirror the client's contract
 * (`internal/platform/reddit/client.go`: finite, within (0, 1e9]); creation is async, so an over-cap budget would be a job
 * that dies later. The 1 USD floor is deliberately stricter than upstream: a sub-dollar campaign buys nothing, so it is
 * far more likely a typo, and the siblings use the same floor. LFXV2-3315 covers bringing the siblings into line.
 */
export function redditBudgetIsUsable(budgetUsd: number): boolean {
  return Number.isFinite(budgetUsd) && budgetUsd >= 1 && budgetUsd <= REDDIT_MAX_BUDGET_USD;
}

/** The video goal as the request carries it, or `null` when it is not one of `REDDIT_VIDEO_GOALS` (a restored draft is not type-checked). */
export function redditEffectiveVideoGoal(goal: string): RedditVideoGoal | null {
  return (REDDIT_VIDEO_GOALS as readonly string[]).includes(goal) ? (goal as RedditVideoGoal) : null;
}

/** The message under the goal picker while Video Views has no usable goal, else `null`. */
export function redditVideoGoalError(objective: RedditObjective, goal: string): string | null {
  return objective === 'video_views' && redditEffectiveVideoGoal(goal) === null ? 'Choose a video goal — Reddit needs one for a Video Views campaign.' : null;
}

/**
 * The message under the Post URL while Video Views has no post, else `null`. A Video Views campaign promotes an existing
 * video post; neither creator checks the creative against the objective, so this is the only place it is enforced.
 */
export function redditVideoPostError(objective: RedditObjective, postUrl: string): string | null {
  return objective === 'video_views' && !postUrl ? 'Video Views promotes an existing Reddit video post — enter its Post URL.' : null;
}

/**
 * Whether a restored objective is no longer one the picker offers, so the control would show another while sending it.
 * The widening cast is deliberate: the constant is narrowed to `SelectableRedditObjective`, which would make `.includes()`
 * reject the very value asked about.
 */
export function redditObjectiveIsUnavailable(objective: RedditObjective): boolean {
  return !(REDDIT_SELECTABLE_OBJECTIVES as readonly RedditObjective[]).includes(objective);
}

/** Whether a restored call to action is no longer a Reddit label. `''` is the real "let upstream default" choice, never unavailable. */
export function redditCallToActionIsUnavailable(callToAction: string): boolean {
  return callToAction !== '' && !(REDDIT_CALL_TO_ACTIONS as readonly string[]).includes(callToAction);
}

/** Why the Reddit section holds Create, or `null`. The first failing check wins; each message names its fix. */
export function redditCreateRefusal(input: RedditCreateRefusalInput): string | null {
  if (!redditBudgetIsUsable(input.budgetUsd)) return 'Reddit Ads: set a budget Reddit accepts.';
  // No usable geo at all: the request would carry [''], which Reddit cannot target and the preview does not show.
  if (input.geoTargetCount === 0) return 'Reddit Ads: add a location, or a country code.';
  // Video Views with no usable goal: both creators refuse it before anything is created, which would arrive as a dead job.
  if (input.videoGoalError !== null) return 'Reddit Ads: fix the Video Views goal.';
  // Video Views without a post would build an image-post ad or no ad, never a video view.
  if (input.videoPostError !== null) return 'Reddit Ads: Video Views needs a video post.';
  return null;
}
