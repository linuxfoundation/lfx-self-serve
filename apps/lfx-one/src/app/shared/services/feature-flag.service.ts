// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, Signal, signal } from '@angular/core';
import { User } from '@lfx-one/shared';
import { Client, EvaluationContext, JsonValue, OpenFeature, ProviderEvents } from '@openfeature/web-sdk';

@Injectable({
  providedIn: 'root',
})
export class FeatureFlagService {
  private client: Client | null = null;
  private readonly isInitialized = signal<boolean>(false);
  private readonly context = signal<EvaluationContext | null>(null);

  // Public readonly signals
  public readonly initialized = this.isInitialized.asReadonly();

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
        targetingKey: user.preferred_username || user.username || user.sub,
      };

      await OpenFeature.setContext(userContext);
      this.client = OpenFeature.getClient();
      this.context.set(userContext);
      this.isInitialized.set(true);

      this.setupEventHandlers();
    } catch (error) {
      console.error('Failed to initialize feature flag service:', error);
      this.isInitialized.set(false);
    }
  }

  /**
   * Get a boolean feature flag as a signal
   * Returns computed signal that updates automatically when flag changes
   */
  public getBooleanFlag(key: string, defaultValue: boolean = false): Signal<boolean> {
    return computed(() => {
      // Reactive dependency on context signal
      this.context();

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
    this.client.addHandler(ProviderEvents.Ready, forceSignalUpdate);
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
}
