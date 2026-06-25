// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MktgAgent } from '../interfaces';

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

// Marketing OS agent catalog — the single source of truth for the marketplace
// tiles (LFXAI-98) and per-agent chat (LFXAI-99). Only agents with a live Guild
// `guildAgentHandle` are `active`; the rest of the mockup's tiles are added as
// `coming-soon` in a later story once their Guild agents exist.
//
// `guildAgentHandle` values must match a LIVE agent's name in the
// linux-foundation/marketing-os Guild workspace, or routing silently fails.
// `foundation-message` is confirmed live (Guild agent linux-foundation~foundation-message).
export const MKTG_AGENTS: MktgAgent[] = [
  {
    id: 'foundation-setup',
    number: 1,
    name: 'Foundation Setup Agent',
    tags: ['Summaries', 'Boilerplate'],
    status: 'active',
    description:
      'Generates the initial marketing content set — 25/50-word summaries, boilerplate, personas, a slide outline, and a getting-started ebook — for a new Linux Foundation project. Step 1 of the LFX Marketing OS Foundation Setup process.',
    icon: 'fa-light fa-landmark',
    guildAgentHandle: 'foundation-message',
  },
];
