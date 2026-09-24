// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, inject, signal } from '@angular/core';
import { MEETING_V2_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';

import { MeetingDetailsComponent } from '../meeting-details/meeting-details.component';
import { MeetingJoinComponent } from '../meeting-join-v1/meeting-join.component';

/**
 * Route target for the public meeting page `/meetings/:id` (#2873). Renders the pre-v2 page by
 * default and swaps to the v2 tree only once `MEETING_V2_ENABLED_FLAG` resolves true for a
 * targeted, signed-in viewer — a signal-driven `@if` inside one stable route, not a router-level
 * component swap. Same shape as {@link HealthMetricsGateComponent}, for the same reasons.
 *
 * **Why a shim and not a `CanMatchFn`.** `provideFeatureFlags` returns before
 * `setProviderAndWait` when `typeof window === 'undefined'`, and `getBooleanFlag` answers with its
 * default while `!isInitialized()`, so SSR *always* evaluates this flag as `false`. Nothing carries
 * a flag value across `TransferState`. The established dark-launch guards
 * (`mentorship-enabled.guard.ts` and siblings) therefore return `true` on the server — which here
 * would SSR the *v2* route target and then match v1 on the browser for the ~100% of viewers the
 * flag is off for, i.e. a whole-route swap at hydration paid by everyone who should never see v2.
 * The other option, a guard that `await`s `waitForReady()`, holds the entire client render of a
 * public, anonymous-reachable, SSR-first page behind a LaunchDarkly round trip (up to
 * `FEATURE_FLAG_READY_TIMEOUT_MS`) for every visitor, defeating the TransferState-seeded first
 * paint this page was built around (GH-2041). Those guards can return `true` on the server only
 * because their routes are authenticated, in-shell, and never SSR-rendered for a logged-out
 * visitor; this one is none of those.
 *
 * Accepted trade-off: a targeted viewer's first paint is the pre-v2 page, and v2 replaces it once
 * post-hydration. That is a content swap, not a hydration mismatch — the `hydrated` latch means
 * Angular never reconciles two different trees. Making v2's *first* paint v2 requires giving SSR a
 * flag source (a LaunchDarkly server SDK, or the BFF stamping the decision into a cookie /
 * `runtimeConfig`); that is #2920, the prerequisite for ramping this flag past a tester list, so do
 * that rather than widening targeting through this gate.
 *
 * Two consequences of that server-side `false` which #2874 should not have to rediscover. First,
 * the pre-v2 page is what SSR renders and what runs the public meeting lookup, including for a
 * targeted viewer — so when that lookup fails it calls `router.navigate(['/meetings/not-found'])`
 * during SSR (`meeting-join.component.ts`) and the URL is decided for *both* branches. v1's lookup
 * therefore governs reachability until SSR has a flag source, which matters the moment v2 grows a
 * data flow of its own. Second, v2 is loaded through `@defer`, so the route's chunk carries only v1
 * and the ~100% of visitors on it never download the v2 tree. This route is public, SSR-first and
 * anonymous-reachable, unlike the authenticated in-shell route that sets the static-import
 * precedent. The cost lands on targeted viewers only: v1 is torn down when the flag flips, so the
 * region is empty until the v2 chunk arrives. That gap is part of the same post-hydration swap #2920
 * removes, and it is why the deferred block triggers `on immediate` rather than waiting for idle.
 *
 * Anonymous viewers always get v1, enforced here rather than through targeting: this route is
 * `auth: 'optional'` (`auth.middleware.ts`) and a LaunchDarkly tester list cannot express "not
 * logged out". `authenticated()` reading false on an early client render only delays the swap,
 * which fails in the safe direction.
 *
 * `v2Enabled` is forced false until `hydrated` latches in `afterNextRender` (a no-op on the
 * server). Without the latch the non-production localStorage override in `FeatureFlagService`
 * reads synchronously, ahead of `isInitialized()`, so a pre-seeded override — exactly what
 * `stubMeetingsV2Flag` does in e2e — would swap trees on the very first client render and mismatch
 * the SSR-rendered v1 DOM.
 */
@Component({
  selector: 'lfx-meeting-details-gate',
  imports: [MeetingJoinComponent, MeetingDetailsComponent],
  templateUrl: './meeting-details-gate.component.html',
})
export class MeetingDetailsGateComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly userService = inject(UserService);

  private readonly hydrated = signal(false);
  private readonly rawV2Enabled = this.featureFlagService.getBooleanFlag(MEETING_V2_ENABLED_FLAG, false);

  protected readonly v2Enabled = computed(() => this.hydrated() && this.userService.authenticated() && this.rawV2Enabled());

  public constructor() {
    afterNextRender(() => this.hydrated.set(true));
  }
}
