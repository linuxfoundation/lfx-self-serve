// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '@environments/environment';
import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, FEATURE_FLAG_READY_TIMEOUT_MS, User } from '@lfx-one/shared';
import { FeatureFlagGuardContext } from '@lfx-one/shared/interfaces';
import { LaunchDarklyClientProvider } from '@openfeature/launchdarkly-client-provider';
import { Client, EvaluationContext, GeneralError, JsonValue, OpenFeature, ProviderEvents, ProviderStatus } from '@openfeature/web-sdk';
import { catchError, filter, firstValueFrom, of, timeout } from 'rxjs';

import { DataDogRumService } from './datadog-rum.service';

/**
 * A locally-forced value for one flag, or `undefined` when none is set.
 *
 * Exists so automated tests can pin a flag without reaching LaunchDarkly. Without it a flag-gated
 * route cannot be tested at all: the SDK evaluates first against an anonymous context and only
 * later against the authenticated user, so a flag targeted at named users reads false in that first
 * window and a `canMatch` guard can redirect before the real value ever arrives. Intercepting the
 * SDK at the network layer was tried and is not workable — aborting its stream stops the provider
 * reaching READY, and serving one keeps it reconnecting.
 *
 * **Ignored entirely in production builds**, so it cannot be used to unlock a flag against a
 * deployed environment.
 */
function readFlagOverride(key: string): boolean | undefined {
  if (environment.production || typeof window === 'undefined') return undefined;

  try {
    const raw = window.localStorage.getItem(FEATURE_FLAG_OVERRIDE_STORAGE_KEY);
    if (raw === null) return undefined;
    const value = (JSON.parse(raw) as Record<string, unknown>)[key];
    return typeof value === 'boolean' ? value : undefined;
  } catch {
    // Unreadable or malformed storage must never take a flag decision with it.
    return undefined;
  }
}

@Injectable({
  providedIn: 'root',
})
export class FeatureFlagService {
  private readonly dataDogRumService = inject(DataDogRumService);

  private client: Client | null = null;
  private readonly isInitialized = signal<boolean>(false);
  private readonly isProviderReady = signal<boolean>(false);
  private readonly context = signal<EvaluationContext | null>(null);
  private errorRecoveryListenerAttached = false;

  /**
   * Built once as a field (not per-call) so `waitForReady()` can be awaited from anywhere —
   * `toObservable()` only needs the injection context at construction time, and a service field
   * initializer already runs inside one.
   */
  private readonly providerReady$ = toObservable(this.isProviderReady);

  /**
   * Built alongside `providerReady$` for the same reason — lets `attachErrorRecoveryListener()`
   * await `initialize()` finishing from a callback that can fire before `initialize()` itself
   * assigns `client`/`context` (see that method's docstring).
   */
  private readonly initialized$ = toObservable(this.isInitialized);

  // Public readonly signals
  public readonly initialized = this.isInitialized.asReadonly();

  /** True once the OpenFeature provider reaches READY (real flag values streamed); distinct from `initialized` (user context applied). */
  public readonly providerReady = this.isProviderReady.asReadonly();

  /**
   * Initialize OpenFeature client with user context
   * Call this method from app.component when user is authenticated
   */
  public async initialize(user: User): Promise<void> {
    if (this.isInitialized()) {
      return;
    }

    try {
      const userContext: EvaluationContext = {
        kind: 'user',
        name: user.name || '',
        email: user.email || '',
        targetingKey: user.preferred_username || user.username || user['https://sso.linuxfoundation.org/claims/username'],
      };

      await OpenFeature.setContext(userContext);
      this.client = OpenFeature.getClient();
      this.context.set(userContext);
      this.isInitialized.set(true);

      // Register handlers BEFORE seeding from the current status so a READY
      // transition that lands in the gap can't be missed: the Ready handler
      // covers the slower streaming case, and the status seed below covers the
      // already-READY case (the app initializer awaits setProviderAndWait before
      // bootstrap). Setting the signal twice is idempotent.
      this.setupEventHandlers();

      // `rawProviderStatus()` alone isn't enough here: it's set once during the provider's own
      // bootstrap `initialize()` and never written again (see `rawProviderStatus()`), so it can't
      // observe `setContext()` above failing to apply the authenticated user context — that
      // failure surfaces only as `client.providerStatus` moving to ERROR. `OpenFeature.setContext()`
      // resolves regardless of whether a provider's own context-change handler succeeded, so this
      // can't be caught by the try/catch either. Requiring both statuses READY keeps the service
      // fail-closed for either kind of failure instead of trusting a raw-READY that only reflects
      // the anonymous bootstrap having gone fine.
      if (this.client.providerStatus === ProviderStatus.ERROR) {
        this.dataDogRumService.addError(new Error('Feature flag provider context change failed'), { source: 'initialize' });
      } else if (this.rawProviderStatus() === ProviderStatus.READY && this.client.providerStatus === ProviderStatus.READY) {
        this.isProviderReady.set(true);
      }

      // Arm recovery whenever either status is ERROR — a raw bootstrap ERROR, a wrapper-only ERROR
      // from this identify() call failing while the raw connection is otherwise fine, or both at
      // once. Nothing else ever retries a failed identify(): setContext() is only called from this
      // service, so a wrapper-only ERROR here would otherwise never recover for the rest of the
      // session. attachErrorRecoveryListener() is idempotent (armed once per session), so calling it
      // from both checks below is safe.
      if (this.rawProviderStatus() === ProviderStatus.ERROR || this.client.providerStatus === ProviderStatus.ERROR) {
        this.attachErrorRecoveryListener();
      }
    } catch (error) {
      console.error('Failed to initialize feature flag service:', error);
      this.isInitialized.set(false);
    }
  }

  /**
   * Wait for the provider to reach READY, up to `timeoutMs`.
   *
   * Every flag-gated route guard needs this exact wait — the provider can still be initializing
   * (or stuck, if LaunchDarkly was slow/unreachable during app bootstrap) when a user navigates.
   * Centralized here so the timeout's fail path is instrumented exactly once, rather than
   * duplicated per guard — a guard that resolves this way is otherwise a silent redirect with no
   * way to tell it happened after the fact (see GH-1351); LD's own logger is disabled in
   * production and a `console.*` call isn't forwarded to RUM.
   *
   * Default is `FEATURE_FLAG_READY_TIMEOUT_MS`, not a guard-local literal — DEV/PROD
   * reproductions after the initial GH-1351 fix showed LaunchDarkly occasionally taking longer
   * than the original 5s to stream READY, which the fail-closed guards surfaced as a user-visible
   * redirect even though LD wasn't actually down. Raising the shared budget reduces false
   * fail-closed/fail-open outcomes for every guard at once.
   *
   * Safe to call from any async context — `providerReady$` is built once as a field, so this no
   * longer needs the injection context that building it per-call would have required.
   *
   * Reports once per call, not deduped across calls — intentional: per-navigation frequency is
   * the signal (a sustained outage should show as sustained RUM volume, not a single flat line).
   *
   * Short-circuits on the provider already in ERROR status instead of waiting out `timeoutMs`
   * again. Checks `rawProviderStatus()` (the provider instance's own status), not
   * `OpenFeature.getClient().providerStatus`: the pinned `@openfeature/launchdarkly-client-provider`
   * (0.3.3) catches its own bootstrap `initializationTimeout` failure internally and resolves
   * instead of rejecting, so the OpenFeature SDK sees a successful `initialize()` and marks its own
   * wrapper READY — `client.providerStatus` can never observe this failure, it would always read
   * READY. Without reading the provider's own status here, every guard would burn its own full
   * budget on top of the bootstrap wait that already failed, turning a real outage into a stall of
   * roughly double `FEATURE_FLAG_READY_TIMEOUT_MS` — or, worse, proceed as if ready at all (see
   * `rawProviderStatus()`).
   *
   * ERROR is not treated as permanent: `attachErrorRecoveryListener()` is called here (and from
   * `initialize()`/the Ready handler) so a LaunchDarkly connection that only lost the race against
   * `initializationTimeout` — rather than genuinely failing — still flips `isProviderReady` once it
   * actually completes, instead of fail-closing every guard for the rest of the session.
   *
   * Also short-circuits on `client.providerStatus` ERROR (the wrapper-ERROR case from a failed
   * `setContext()` — see `initialize()`), and arms `attachErrorRecoveryListener()` for it too:
   * nothing else ever retries a failed `identify()` call, so without arming recovery here a
   * wrapper-only ERROR would never flip `isProviderReady` back on, and every guard would burn the
   * full `timeoutMs` on a `providerReady$` wait that can never resolve.
   */
  public async waitForReady(context: FeatureFlagGuardContext, timeoutMs = FEATURE_FLAG_READY_TIMEOUT_MS): Promise<boolean> {
    if (this.isProviderReady()) {
      return true;
    }

    if (this.rawProviderStatus() === ProviderStatus.ERROR) {
      this.attachErrorRecoveryListener();
      this.dataDogRumService.addError(new Error('Feature flag provider not ready before guard timeout'), context);
      return false;
    }

    if (this.client?.providerStatus === ProviderStatus.ERROR) {
      this.attachErrorRecoveryListener();
      this.dataDogRumService.addError(new Error('Feature flag provider not ready before guard timeout'), context);
      return false;
    }

    const ready = await firstValueFrom(
      this.providerReady$.pipe(
        filter((isReady): isReady is true => isReady === true),
        timeout(timeoutMs),
        catchError(() => of(false))
      )
    );

    if (!ready) {
      this.dataDogRumService.addError(new Error('Feature flag provider not ready before guard timeout'), context);
    }

    return ready;
  }

  /**
   * A value pinned locally for this flag, or `undefined` when none is set.
   *
   * Exposed so a route guard can consult it *before* waiting on the provider. A guard that decides
   * on a readiness timeout would otherwise ignore a pinned value entirely — including a pinned
   * `false`, which is the case that must never be overridden.
   */
  public getFlagOverride(key: string): boolean | undefined {
    return readFlagOverride(key);
  }

  /**
   * Get a boolean feature flag as a signal
   * Returns computed signal that updates automatically when flag changes
   */
  public getBooleanFlag(key: string, defaultValue: boolean = false): Signal<boolean> {
    return computed(() => {
      // Reactive dependency on context signal
      this.context();

      const override = readFlagOverride(key);
      if (override !== undefined) {
        return override;
      }

      if (!this.isInitialized() || !this.client) {
        return defaultValue;
      }

      try {
        return this.client.getBooleanValue(key, defaultValue);
      } catch (error) {
        console.error(`Error evaluating boolean flag '${key}':`, error);
        return defaultValue;
      }
    });
  }

  /**
   * Get a string feature flag as a signal
   * Returns computed signal that updates automatically when flag changes
   */
  public getStringFlag(key: string, defaultValue: string = ''): Signal<string> {
    return computed(() => {
      // Reactive dependency on context signal
      this.context();

      if (!this.isInitialized() || !this.client) {
        return defaultValue;
      }

      try {
        return this.client.getStringValue(key, defaultValue);
      } catch (error) {
        console.error(`Error evaluating string flag '${key}':`, error);
        return defaultValue;
      }
    });
  }

  /**
   * Get a number feature flag as a signal
   * Returns computed signal that updates automatically when flag changes
   */
  public getNumberFlag(key: string, defaultValue: number = 0): Signal<number> {
    return computed(() => {
      // Reactive dependency on context signal
      this.context();

      if (!this.isInitialized() || !this.client) {
        return defaultValue;
      }

      try {
        return this.client.getNumberValue(key, defaultValue);
      } catch (error) {
        console.error(`Error evaluating number flag '${key}':`, error);
        return defaultValue;
      }
    });
  }

  /**
   * Get an object feature flag as a signal
   * Returns computed signal that updates automatically when flag changes
   */
  public getObjectFlag<T extends JsonValue = JsonValue>(key: string, defaultValue: T): Signal<T> {
    return computed(() => {
      // Reactive dependency on context signal
      this.context();

      if (!this.isInitialized() || !this.client) {
        return defaultValue;
      }

      try {
        return this.client.getObjectValue<T>(key, defaultValue);
      } catch (error) {
        console.error(`Error evaluating object flag '${key}':`, error);
        return defaultValue;
      }
    });
  }

  /**
   * Set up event handlers for real-time flag updates
   */
  private setupEventHandlers(): void {
    if (!this.client) {
      return;
    }

    const forceSignalUpdate = () => {
      // Force re-evaluation by updating context reference
      this.refreshFlags();
    };

    // Set up event handlers for flag changes
    this.client.addHandler(ProviderEvents.Ready, () => {
      // The SDK fires this even when the pinned LaunchDarkly provider swallowed its own bootstrap
      // timeout and resolved instead of rejecting — see rawProviderStatus(). Don't trust it blindly.
      if (this.rawProviderStatus() === ProviderStatus.ERROR) {
        this.attachErrorRecoveryListener();
        return;
      }

      this.isProviderReady.set(true);
      forceSignalUpdate();
    });
    this.client.addHandler(ProviderEvents.ConfigurationChanged, forceSignalUpdate);
    this.client.addHandler(ProviderEvents.ContextChanged, forceSignalUpdate);
    this.client.addHandler(ProviderEvents.Reconciling, forceSignalUpdate);
    this.client.addHandler(ProviderEvents.Stale, forceSignalUpdate);
    this.client.addHandler(ProviderEvents.Error, () => {
      console.error('Feature flag provider error');
    });
  }

  /**
   * Refresh flags by updating context reference
   */
  private refreshFlags(): void {
    const current = this.context();
    if (current) {
      this.context.set({ ...current });
    }
  }

  /**
   * The registered provider's own status, not the OpenFeature SDK's wrapper-tracked status.
   *
   * The pinned `@openfeature/launchdarkly-client-provider` (0.3.3) catches its own bootstrap
   * `initializationTimeout` failure internally and resolves instead of rejecting, so the SDK's
   * `setAwaitableProvider` sees a successful `initialize()` and marks its wrapper READY (firing a
   * `Ready` event) regardless of whether LaunchDarkly actually initialized. `client.providerStatus`
   * reads that wrapper state, not the provider's own — it can never observe this failure. The
   * provider instance itself is the only thing that knows: its own `initialize()` sets its own
   * `status` field to ERROR in this exact path. `OpenFeature.getProvider()` returns that instance.
   */
  private rawProviderStatus(): ProviderStatus | undefined {
    const provider = OpenFeature.getProvider();
    return provider instanceof LaunchDarklyClientProvider ? provider.status : undefined;
  }

  /**
   * Un-sticks a `rawProviderStatus()` ERROR that turns out to be transient, or a wrapper-only
   * `client.providerStatus` ERROR from a failed `identify()` call while the raw connection is fine
   * (see `initialize()` and `waitForReady()`, which both arm this for either case). For the
   * wrapper-only case, `rawClient.waitForInitialization()` below is typically already settled (the
   * raw connection succeeded), so `attemptRecovery` runs on the next microtask rather than waiting
   * on a live connection — it re-applies the stored context and checks the outcome exactly the same
   * way either way.
   *
   * `waitForInitialization(initializationTimeout)` races a timeout against the LaunchDarkly
   * client's real connection rather than cancelling it — a slow (not broken) connection keeps
   * trying in the background after the provider gives up and records ERROR, and that field is
   * never written again (see `rawProviderStatus()`). The wrapper's own `Ready` event doesn't help
   * either: it fires exactly once, tied to that same already-resolved `initialize()` call.
   *
   * The underlying LaunchDarkly client's own `initialized`/`failed` events fire if and when the
   * connection actually settles, but an event listener attached here can miss one that already
   * fired in the background before this method ran — Angular only calls `initialize()` (and thus
   * this method) after its app initializer's own bootstrap wait, so that gap is real. The client's
   * `waitForInitialization()` promise doesn't have that gap: like any Promise, it keeps its settled
   * value for any `.then()` attached after the fact, so calling it here — whether the client is
   * still connecting, already succeeded, or already failed — always observes the outcome correctly.
   *
   * A rejection here is not necessarily permanent either: in the pinned LaunchDarkly SDK this
   * promise only ever rejects from the *initial* bootstrap `fetchFlagSettings` call failing (e.g. a
   * transient network error), which permanently latches this one promise as failed — but `identify()`
   * (invoked via `OpenFeature.setContext()`) runs its own independent `fetchFlagSettings` on every
   * call and can still succeed regardless of that latch, including a call already in flight from
   * `initialize()` racing against this same rejection. So both outcomes run the same
   * reapply-and-check logic below rather than treating rejection as fail-closed with nothing to
   * recover from.
   *
   * `client` is `private` in this pinned provider version's own `.d.ts`, but that's a compile-time
   * annotation only; the getter is a plain runtime property. Reaching through it is the only way to
   * observe this.
   *
   * Resolving `waitForInitialization()` only proves the raw client's own (anonymous) bootstrap
   * connection came up — it says nothing about whether the authenticated user context from
   * `initialize()` was ever successfully applied. If `setContext()` also failed while the raw
   * provider was down (the raw-ERROR/wrapper-ERROR combination `initialize()` handles), marking
   * ready here would let guards evaluate flags against the wrong (anonymous) context. So the stored
   * context is re-applied once the raw client recovers, and readiness is only seeded once that
   * re-application leaves the wrapper itself in READY — mirroring the same both-statuses-READY
   * requirement `initialize()` already enforces.
   *
   * This method can be called (via `waitForReady()`) before `initialize()` itself has finished —
   * `AppComponent` starts `initialize()` without awaiting it, and `initialize()` only assigns
   * `client`/`context` after its own `await OpenFeature.setContext()` resolves. If the raw client's
   * `waitForInitialization()` had already settled by then, reading `this.context()`/`this.client`
   * immediately would see them still null, permanently reporting a false reapplication failure —
   * `errorRecoveryListenerAttached` is one-shot, so this would never get another chance to run for
   * the rest of the session. Waiting for `this.isInitialized()` first closes that gap.
   */
  private attachErrorRecoveryListener(): void {
    if (this.errorRecoveryListenerAttached) {
      return;
    }

    const provider = OpenFeature.getProvider();
    if (!(provider instanceof LaunchDarklyClientProvider)) {
      return;
    }

    try {
      const rawClient = (provider as unknown as { client: { waitForInitialization: () => Promise<void> } }).client;
      this.errorRecoveryListenerAttached = true;

      const attemptRecovery = async (): Promise<void> => {
        if (!this.isInitialized()) {
          await firstValueFrom(this.initialized$.pipe(filter((initialized): initialized is true => initialized === true)));
        }

        const context = this.context();
        if (context) {
          try {
            await OpenFeature.setContext(context);
          } catch {
            // Checked via client.providerStatus below regardless of outcome.
          }
        }

        if (this.client?.providerStatus === ProviderStatus.READY) {
          this.isProviderReady.set(true);
          this.refreshFlags();
        } else {
          this.dataDogRumService.addError(new Error('Feature flag provider context reapplication failed after recovery'), {
            source: 'attachErrorRecoveryListener',
          });
        }
      };

      rawClient.waitForInitialization().then(attemptRecovery, attemptRecovery);
    } catch (error) {
      // GeneralError = provider recorded ERROR before creating its client; nothing to recover.
      // Anything else means the provider's internals moved — report it rather than silently
      // fail-closing every guard for the session.
      if (!(error instanceof GeneralError)) {
        this.dataDogRumService.addError(error instanceof Error ? error : new Error(String(error)), {
          source: 'attachErrorRecoveryListener',
        });
      }
    }
  }
}
