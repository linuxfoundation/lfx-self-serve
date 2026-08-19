// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MktgAgent } from '../interfaces';

// Shared labels for the Marketing OS Agents marketplace (LFXAI-95 workstream).
// Centralized so the nav item, route, and landing page stay in sync.
// Product copy always spells out "Marketing" (never "Mktg"); "MKTG"/"mktg" stays
// only in code identifiers and route segments.
export const MKTG_OS_AGENTS_LABEL = {
  /** Sidebar nav entry, placed directly under Documents. */
  nav: 'Marketing OS',
  /** Marketplace landing page title. */
  marketplaceTitle: 'LFX Marketing OS Marketplace',
  /** Short description shown under the landing page title. */
  marketplaceDescription: 'Run LFX marketing agents for your project.',
} as const;

/** Route segment (lens-prefixed at the route layer, e.g. /project/mktg-os-agents). */
export const MKTG_OS_AGENTS_ROUTE_SEGMENT = 'mktg-os-agents';

// Marketing OS agent catalog — the single source of truth for the marketplace
// grid and the form-first agent run pages. Only agents with BOTH a live Guild
// `guildAgentHandle` AND a registered intake form (MKTG_AGENT_INTAKES in
// mktg-run.constants.ts) are `active`; everything else renders as a disabled
// "Coming soon" card.
//
// `guildAgentHandle` values must match a LIVE agent's name in the
// linux-foundation/marketing-os Guild workspace, or routing silently fails.
// `brand-kit` is live (Guild agent linux-foundation~brand-kit).
export const MKTG_AGENTS: MktgAgent[] = [
  {
    id: 'brand-kit',
    number: 1,
    name: 'Brand Kit Agent',
    tags: ['Brand', 'Identity'],
    status: 'active',
    description:
      'Develops a full project brand kit — positioning, voice, visual identity brief, palette, typography, and taglines — from seven intake questions. Logos, colors, and fonts are generated output, not inputs.',
    icon: 'fa-light fa-droplet',
    accent: 'violet',
    guildAgentHandle: 'brand-kit',
  },
  // Live Guild agent (linux-foundation~foundation-message), but its batch
  // intake form ships separately (wi-mf-lfx-selfserve). The form-first UI has
  // no run surface for it until then, so it stays `coming-soon` — flipping it
  // back to `active` (handle `foundation-message`) lands with its intake form.
  {
    id: 'foundation-setup',
    number: 2,
    name: 'Message Foundation Agent',
    tags: ['Messaging', 'Summaries'],
    status: 'coming-soon',
    description:
      'Builds the messaging foundation for a Linux Foundation project — positioning, audiences, pillars, talking points, plus the 25/50-word summaries, boilerplate, llms.txt, and elevator pitch.',
    icon: 'fa-light fa-landmark',
    accent: 'blue',
  },
  {
    id: 'icp',
    number: 3,
    name: 'ICP Agent',
    tags: ['Personas', 'Research'],
    status: 'coming-soon',
    description: 'Defines your ideal customer profile and audience segments from project and ecosystem data.',
    icon: 'fa-light fa-user-group',
    accent: 'emerald',
  },
  {
    id: 'pitch-deck',
    number: 4,
    name: 'Pitch Deck Agent',
    tags: ['Slides', 'Narrative'],
    status: 'coming-soon',
    description: 'Drafts a sponsor-ready pitch deck outline and slide copy for your project.',
    icon: 'fa-light fa-presentation-screen',
    accent: 'amber',
  },
  {
    id: 'qtrly-plan',
    number: 5,
    name: 'Quarterly Plan Agent',
    tags: ['Planning'],
    status: 'coming-soon',
    description: 'Turns goals and signals into a quarterly marketing plan with owners and milestones.',
    icon: 'fa-light fa-calendar-days',
    accent: 'red',
  },
  {
    id: 'linkedin-post',
    number: 6,
    name: 'LinkedIn Post Agent',
    tags: ['Social', 'Copy'],
    status: 'coming-soon',
    description: 'Writes LinkedIn post drafts in your project voice from releases, events, and news.',
    icon: 'fa-light fa-bullhorn',
    accent: 'blue',
  },
  {
    id: 'website-builder',
    number: 7,
    name: 'Website Builder Agent',
    tags: ['Web'],
    status: 'coming-soon',
    description: 'Assembles a starter marketing site from your foundation content and brand kit.',
    icon: 'fa-light fa-globe',
    accent: 'violet',
  },
  {
    id: 'aeo-geo',
    number: 8,
    name: 'AEO / GEO Agent',
    tags: ['Search', 'AI visibility'],
    status: 'coming-soon',
    description: 'Audits and improves how AI assistants and search engines describe your project.',
    icon: 'fa-light fa-chart-line',
    accent: 'emerald',
  },
];
