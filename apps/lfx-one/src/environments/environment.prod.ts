// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const environment = {
  production: true,
  urls: {
    home: 'https://app.lfx.dev',
    support: 'https://jira.linuxfoundation.org/plugins/servlet/desk',
    pcc: 'https://projectadmin.lfx.linuxfoundation.org',
    changelog: 'https://changelog.lfx.dev/',
    mentorship: 'https://mentorship.lfx.linuxfoundation.org/',
    crowdfunding: 'https://crowdfunding.linuxfoundation.org/',
    enrollment: 'https://enrollment.lfx.linuxfoundation.org/',
    // EasyCLA Contributor Console — sign-out target for new ICLAs/ECLAs (M1 read-only links out here).
    // TODO(M1): confirm the exact prod host with the EasyCLA team before enabling the flag.
    contributorConsole: 'https://contributor.easycla.lfx.linuxfoundation.org/',
  },
  segment: {
    cdnUrl: 'https://lfx-segment.platform.linuxfoundation.org/latest/lfx-segment-analytics.min.js?ver=1.0.1',
    enabled: true,
  },
  plausible: {
    enabled: true,
  },
  datadog: {
    site: 'datadoghq.com',
    service: 'lfx-self-serve',
    env: 'production',
  },
};
