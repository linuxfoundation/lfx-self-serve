// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Declare the build-time constant that will be injected via Angular's define
declare const LAUNCHDARKLY_CLIENT_ID: string | undefined;

export const environment = {
  production: false,
  urls: {
    home: 'http://localhost:4200',
    support: 'https://jira.linuxfoundation.org/plugins/servlet/desk',
  },
  segment: {
    cdnUrl: 'https://lfx-segment.dev.platform.linuxfoundation.org/latest/lfx-segment-analytics.min.js?ver=1.0.1',
    enabled: true,
  },
  // Use build-time constant if available, otherwise dev client ID for local ng serve
  // When using Docker/production builds, LAUNCHDARKLY_CLIENT_ID is injected via --define
  // For local development with ng serve, falls back to hardcoded dev client ID
  launchDarklyClientId: LAUNCHDARKLY_CLIENT_ID || '691b727361cbf309e9d74468',
};
