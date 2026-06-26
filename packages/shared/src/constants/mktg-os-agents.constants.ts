// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Shared labels for the Marketing OS Agents marketplace (LFXAI-95 workstream).
// Centralized so the nav item, route, and landing page stay in sync.
// The nav reads "Marketing OS"; the landing title matches the mockup ("LFX Mktg OS Marketplace").
export const MKTG_OS_AGENTS_LABEL = {
  /** Sidebar nav entry, placed directly under Documents. */
  nav: 'Marketing OS',
  /** Marketplace landing page title (mockup). */
  marketplaceTitle: 'LFX Mktg OS Marketplace',
  /** Short description shown under the landing page title. */
  marketplaceDescription: 'Browse and chat with LFX marketing agents.',
} as const;

/** Route segment (lens-prefixed at the route layer, e.g. /project/mktg-os-agents). */
export const MKTG_OS_AGENTS_ROUTE_SEGMENT = 'mktg-os-agents';
