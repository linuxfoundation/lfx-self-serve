// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const LINKS_CONFIG = {
  EVENTS: {
    DISCOVER: 'https://events.linuxfoundation.org/',
  },
  INSIGHTS: {
    BASE: 'https://insights.linuxfoundation.org',
  },
  /**
   * User documentation for the Company Lens (#5447). Company Lens empty and error states may link only to the
   * person's own profile or to these pages. The pages are served from the repository until a published docs
   * site exists; swap the base here and every empty state follows.
   */
  DOCS: {
    COMPANY_LENS_ACCESS: 'https://github.com/linuxfoundation/lfx-self-serve/blob/main/docs/user/organization/choose-an-organization/index.md',
    COMPANY_LENS_OVERVIEW: 'https://github.com/linuxfoundation/lfx-self-serve/blob/main/docs/user/organization/org-overview/index.md',
    COMPANY_LENS_EASYCLA: 'https://github.com/linuxfoundation/lfx-self-serve/blob/main/docs/user/organization/easycla/index.md',
  },
};
