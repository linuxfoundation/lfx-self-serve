// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const environment = {
  production: false,
  urls: {
    home: 'https://app.dev.lfx.dev',
    pcc: 'https://pcc.dev.platform.linuxfoundation.org',
    changelog: 'https://changelog.lfx.dev/',
    mentorship: 'https://people.dev.platform.linuxfoundation.org/#projects_all',
    crowdfunding: 'https://crowdfunding.dev.lfx.dev/',
    enrollment: 'https://joinnow.dev.platform.linuxfoundation.org/',
    // EasyCLA Contributor Console — sign-out target for new ICLAs/ECLAs (M1 read-only links out here).
    contributorConsole: 'https://easycla.dev.communitybridge.org/',
    // LFX Corporate CLA Console — My CLAs "Manage in CCLA Console" (#1575).
    corporateConsole: 'https://lfx.dev.platform.linuxfoundation.org/',
    // Individual Dashboard (soft-migration return link target, LFXV2-3336).
    individualDashboard: 'https://myprofile.dev.platform.linuxfoundation.org',
  },
  segment: {
    cdnUrl: 'https://lfx-segment.dev.platform.linuxfoundation.org/latest/lfx-segment-analytics.min.js?ver=1.0.1',
    enabled: true,
  },
  plausible: {
    enabled: false,
  },
  datadog: {
    site: 'datadoghq.com',
    service: 'lfx-self-serve',
    env: 'development',
  },
};
