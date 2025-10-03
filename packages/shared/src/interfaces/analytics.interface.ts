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
 * LFX Segment Analytics API interface
 * @description Type definitions for LfxSegmentsAnalytics object
 */
export interface LfxSegmentAnalytics {
  /** Initialize the analytics instance */
  init(): Promise<void>;
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
