// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const environment = {
  production: false,
  urls: {
    home: 'http://localhost:4200',
    support: 'https://jira.linuxfoundation.org/plugins/servlet/desk',
    pcc: 'https://pcc.dev.platform.linuxfoundation.org',
    changelog: 'https://changelog.lfx.dev/',
    mentorship: 'https://people.dev.platform.linuxfoundation.org/#projects_all',
    crowdfunding: 'https://crowdfunding.dev.lfx.dev/',
    enrollment: 'https://joinnow.dev.platform.linuxfoundation.org/',
    // EasyCLA Contributor Console — sign-out target for new ICLAs/ECLAs (M1 read-only links out here).
    // TODO(M1): confirm the exact dev host with the EasyCLA team before enabling the flag.
    contributorConsole: 'https://contributor.dev.lfx.linuxfoundation.org/',
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
    env: '', // temporarily set to 'local' to test RUM locally
  },
};
