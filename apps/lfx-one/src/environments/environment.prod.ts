// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const environment = {
  production: true,
  urls: {
    home: 'https://app.lfx.dev',
    support: 'https://jira.linuxfoundation.org/plugins/servlet/desk',
  },
  segment: {
    cdnUrl: 'https://lfx-segment.platform.linuxfoundation.org/latest/lfx-segment-analytics.min.js?ver=1.0.1',
    enabled: true,
  },
  datadog: {
    site: 'datadoghq.com',
    service: 'lfx-one',
    env: 'prod',
  },
};
