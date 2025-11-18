// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Declare the build-time constant that will be injected via Angular's define
declare const LAUNCHDARKLY_CLIENT_ID: string | undefined;

export const environment = {
  production: true,
  urls: {
    home: 'https://app.staging.lfx.dev',
    support: 'https://jira.linuxfoundation.org/plugins/servlet/desk',
  },
  segment: {
    cdnUrl: 'https://lfx-segment.dev.platform.linuxfoundation.org/latest/lfx-segment-analytics.min.js?ver=1.0.1',
    enabled: true,
  },
  // Use build-time constant if available, otherwise empty string
  // When using Docker/staging builds, LAUNCHDARKLY_CLIENT_ID is injected via --define
  launchDarklyClientId: LAUNCHDARKLY_CLIENT_ID || '',
};
