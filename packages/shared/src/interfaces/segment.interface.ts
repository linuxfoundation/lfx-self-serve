// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Segment configuration from environment
 */
export interface SegmentConfig {
  /** Segment CDN URL for loading the analytics script */
  cdnUrl: string;
  /** Whether analytics is enabled for this environment */
  enabled: boolean;
}

/**
 * User traits for Segment identify calls
 */
export interface AnalyticsIdentifyTraits {
  /** User's email address */
  email?: string;
  /** User's full name */
  name?: string;
  /** User's first name */
  firstName?: string;
  /** User's last name */
  lastName?: string;
  /** User's username */
  username?: string;
}

/**
 * Page properties for Segment page calls
 */
export interface AnalyticsPageProperties {
  /** Page title */
  title?: string;
  /** Page URL or path */
  path?: string;
  /** Additional custom properties */
  [key: string]: unknown;
}

/**
 * Minimal shape of a Segment event as handed to the LFX wrapper's event sanitizer.
 * Only the fields the app sanitizer reads are typed; the vendor event carries more.
 */
export interface SegmentEvent {
  /** Event kind (page, track, identify, ...) — must not be changed by the sanitizer */
  type: string;
  /** Vendor message id — must not be changed by the sanitizer */
  messageId: string;
  /** Event properties (page/track) */
  properties?: Record<string, unknown>;
  /** Event context, including the SDK-assembled page context */
  context?: {
    /** Page context (url, path, search, referrer, title) */
    page?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Synchronous sanitizer run by the LFX wrapper on every event before delivery.
 * Returning null (or throwing) cancels the event.
 */
export type SegmentEventSanitizer = (event: SegmentEvent) => SegmentEvent | null;

/**
 * Page name and explicitly sanitized page properties sent on route navigation
 */
export interface SegmentPageEvent {
  /** Page name — last segment of the sanitized pathname, or `Home` */
  name: string;
  /** Pathname only */
  path: string;
  /** Absolute URL with only allowlisted query params and no hash */
  url: string;
  /** Allowlisted query string (`?utm_...`) or an empty string */
  search: string;
  /** Document title */
  title: string;
  /** Referrer with only allowlisted query params and no hash, or an empty string */
  referrer: string;
}

/**
 * LFX Segment Analytics API interface
 * @description Type definitions for LfxSegmentsAnalytics object
 */
export interface LfxSegmentAnalytics {
  /** Initialize the analytics instance (unprotected — the app must use `initWithEventSanitizer`) */
  init(): Promise<void>;
  /**
   * Initialize the analytics instance with a sanitizer that runs on every event, including the
   * automatic initial page. Rejects (and never exposes the SDK) when protected setup fails.
   */
  initWithEventSanitizer(sanitizer: SegmentEventSanitizer, writeKey?: string): Promise<void>;
  /** Track a page view */
  page(pageName: string, properties?: Record<string, unknown>): void;
  /** Track a custom event */
  track(eventName: string, properties?: Record<string, unknown>): void;
  /** Identify an Auth0 user */
  identifyAuth0User(auth0User: unknown): void;
  /** Reset analytics state */
  reset(): void;
}

/**
 * LFX Segment Analytics class interface
 * @description Type definitions for LfxSegmentsAnalytics class
 */
export interface LfxSegmentAnalyticsClass {
  /** Get the singleton instance */
  getInstance(): LfxSegmentAnalytics;
}
