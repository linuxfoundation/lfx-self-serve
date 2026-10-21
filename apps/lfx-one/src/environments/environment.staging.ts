// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const environment = {
  production: true,
  urls: {
    home: 'https://app.staging.lfx.dev',
    pcc: 'https://pcc.staging.platform.linuxfoundation.org',
    changelog: 'https://changelog.lfx.dev/',
    mentorship: 'https://mentorship.dev.lfx.dev',
    crowdfunding: 'https://crowdfunding.staging.lfx.dev/',
    enrollment: 'https://joinnow.staging.platform.linuxfoundation.org/',
    // EasyCLA Contributor Console — sign-out target for new ICLAs/ECLAs (M1 read-only links out here).
    contributorConsole: 'https://easycla.staging.communitybridge.org/',
    // LFX Corporate CLA Console — My CLAs "Manage in CCLA Console" (#1575).
    corporateConsole: 'https://lfx.staging.platform.linuxfoundation.org/',
  },
  segment: {
    cdnUrl:
      'https://lfx-segment.dev.platform.linuxfoundation.org/artifacts/sha384-7ab1a7b6cc607bd8184c4fd9046fdd77c7f7ca2c54e36816a67dd395197c6d60d057b6abbd506d59491cf96686b542b6/lfx-segment-analytics.min.js',
    enabled: true,
  },
  plausible: {
    enabled: false,
  },
  datadog: {
    site: 'datadoghq.com',
    service: 'lfx-self-serve',
    env: 'staging',
  },
};
