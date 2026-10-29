// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgAgent } from '../interfaces';

// Shared labels for the Marketing OS Agents marketplace (LFXAI-95 workstream).
// Centralized so the nav item, route, and landing page stay in sync.
// Product copy always spells out "Marketing" (never "Mktg"); "MKTG"/"mktg" stays
// only in code identifiers and route segments.
export const MKTG_OS_AGENTS_LABEL = {
  /** Sidebar nav entry, placed directly under Documents. */
  nav: 'Marketing OS',
} as const;

/** Route segment (lens-prefixed at the route layer, e.g. /project/mktg-os-agents). */
export const MKTG_OS_AGENTS_ROUTE_SEGMENT = 'mktg-os-agents';

/** Shared family copy; the kit-family layer owns generalising the family model. */
export const MKTG_FAMILY_SOCIAL_COMMUNITY = 'Social & community';

// Marketing OS agent catalog — the single source of truth for the marketplace
// grid and the form-first agent run pages. Only agents with BOTH a live Guild
// `guildAgentHandle` AND a registered intake form (MKTG_AGENT_INTAKES in
// mktg-run.constants.ts) are `active`; everything else renders as a disabled
// "Coming soon" card.
//
// `guildAgentHandle` values must match a LIVE agent's name in the
// linux-foundation/marketing-os Guild workspace, or routing silently fails.
// The handle is the NAME half only: the BFF prepends it as the transitional
// `@handle` mention on text messages, and composes the Guild-resolvable
// agent identifier as `<GUILD_WORKSPACE_OWNER>~<handle>` for the explicit
// `agent_id` (the bare name is not a Guild identifier — it 404s).
// `brand-kit` is live (Guild agent linux-foundation~brand-kit), and so is `faq`
// (linux-foundation~faq).
export const MKTG_AGENTS: MktgAgent[] = [
  // Live Guild agent (linux-foundation~foundation-message), the Messaging
  // Framework Agent since 4.0.0 (messaging-framework-output/v1: one JSON
  // bundle, never a Markdown document); the catalog id and Guild name are
  // unchanged. It runs first and needs no other document
  // (dec-run-order-messaging-brand-guidelines-icp), so it has no `dependsOn`
  // and its intake attaches nothing.
  {
    id: 'foundation-setup',
    number: 1,
    name: 'Messaging Framework Agent',
    tags: ['Messaging', 'Positioning'],
    status: 'active',
    description:
      'Vision, mission, positioning, tagline, goal columns, the messaging framework and key numbers. Reads your website, links and documents and researches on its own, then asks only what they leave open. Needs no other document.',
    icon: 'fa-light fa-landmark',
    accent: 'blue',
    guildAgentHandle: 'foundation-message',
  },
  // Live Guild agent (linux-foundation~brand-kit 2.0.0): the kit's tokens
  // come from the project's real logo files, the site's CSS and the approved
  // messaging framework, every colour sourced; the result is a 16-page kit.
  {
    id: 'brand-kit',
    number: 2,
    name: 'Brand Kit Agent',
    tags: ['Brand', 'Identity'],
    status: 'active',
    description:
      'Builds the project’s brand kit from its real logo files and website: the logo system, the palette with every colour sourced and its contrast checked, the typeface, the visual rules, example usage and the voice — a 16-page kit you can print to PDF.',
    icon: 'fa-light fa-droplet',
    accent: 'violet',
    guildAgentHandle: 'brand-kit',
  },
  // Live Guild agent (linux-foundation~boilerplates 1.0.0): the one-liner and
  // the 25, 50 and 100-word boilerplates from the project's messaging
  // framework (boilerplates-output/v1, one JSON asset). It runs after the
  // framework, which its intake attaches as a required attachment; like the
  // Brand Kit, not `dependsOn`, so the card stays open and the run page says
  // what is needed, with the link to the Messaging Framework page.
  {
    id: 'boilerplates',
    number: 3,
    name: 'Boilerplates Agent',
    tags: ['Copy', 'Descriptions'],
    status: 'active',
    description:
      'Writes the project’s one-liner and its 25, 50 and 100-word descriptions, each within its word limit, from your Messaging Framework and the project’s own website, press release and LFX record.',
    icon: 'fa-light fa-paragraph',
    accent: 'amber',
    guildAgentHandle: 'boilerplates',
  },
  // Live Guild agent (linux-foundation~faq 1.0.0, faq-output/v1): one JSON
  // FAQ, grouped questions each answered from the sources or flagged for the
  // team. It runs after the messaging framework: the project's latest stored
  // framework is a REQUIRED attachment on its intake (never `dependsOn`, so
  // the card stays open and the page itself says to run the framework first).
  {
    id: 'faq',
    number: 4,
    name: 'FAQ Agent',
    tags: ['FAQ', 'Messaging'],
    status: 'active',
    description:
      'Eight to ten questions people ask about the project, in three or four groups, each answered in one to three sentences from your sources and worded from your messaging framework, every answer naming its source. A question the sources do not answer is flagged for your team.',
    icon: 'fa-light fa-circle-question',
    accent: 'amber',
    guildAgentHandle: 'faq',
  },
  // Live Guild agent (linux-foundation~icp) with its batch intake form
  // registered in MKTG_AGENT_INTAKES (wi-icp-lfx-selfserve). It CONSUMES the
  // Brand Kit and the Messaging Framework, but only when the project has them:
  // both are optional attachments on the intake, never `dependsOn`, because
  // the agent's own contract makes them optional and its author explicitly
  // allows proceeding on the interview answers plus the README with the
  // affected sections flagged lower-confidence. Gating the card on documents
  // the agent does not require would lock out projects it can serve today.
  {
    id: 'icp',
    number: 5,
    name: 'ICP & Target Markets Agent',
    tags: ['Personas', 'Research'],
    status: 'active',
    description:
      'Defines one to two organization-level ideal customer profiles with their buyer personas, fit and warmth scoring inputs, and the messaging handoff — grounded in your project’s README, Brand Kit and Messaging Framework.',
    icon: 'fa-light fa-user-group',
    accent: 'emerald',
    guildAgentHandle: 'icp',
  },
  {
    id: 'pitch-deck',
    number: 6,
    name: 'Pitch Deck Agent',
    tags: ['Slides', 'Narrative'],
    status: 'coming-soon',
    description: 'Drafts a sponsor-ready pitch deck outline and slide copy for your project.',
    icon: 'fa-light fa-presentation-screen',
    accent: 'amber',
  },
  {
    id: 'qtrly-plan',
    number: 7,
    name: 'Quarterly Plan Agent',
    tags: ['Planning'],
    status: 'coming-soon',
    description: 'Turns goals and signals into a quarterly marketing plan with owners and milestones.',
    icon: 'fa-light fa-calendar-days',
    accent: 'red',
  },
  {
    id: 'linkedin-post',
    number: 8,
    name: 'LinkedIn Post Agent',
    tags: ['Social', 'Copy'],
    status: 'active',
    guildAgentHandle: 'linkedin-post',
    description: 'Writes three LinkedIn post options in your personal voice from pasted text, a link or a file.',
    icon: 'fa-light fa-bullhorn',
    accent: 'blue',
  },
  {
    id: 'website-builder',
    number: 9,
    name: 'Website Builder Agent',
    tags: ['Web'],
    status: 'coming-soon',
    description: 'Assembles a starter marketing site from your foundation content and brand kit.',
    icon: 'fa-light fa-globe',
    accent: 'violet',
  },
  {
    id: 'aeo-geo',
    number: 10,
    name: 'AEO / GEO Agent',
    tags: ['Search', 'AI visibility'],
    status: 'active',
    guildAgentHandle: 'aeo-geo',
    description: 'Audits and improves how AI assistants and search engines describe your project.',
    icon: 'fa-light fa-chart-line',
    accent: 'emerald',
  },
  {
    id: 'member-360',
    number: 9,
    name: 'Member 360 Agent',
    tags: ['Members', 'Engagement'],
    status: 'active',
    description: 'Scores member engagement, finds the gaps and recommends one next action per member.',
    icon: 'fa-light fa-users',
    accent: 'blue',
    guildAgentHandle: 'member-360',
    formOnly: true,
  },
];

/**
 * Longest `/api/mktg-agents/chat` message the BFF forwards to Guild, measured
 * on the trimmed text. Generous because a follow-up carries a whole rendered
 * intake (`renderMktgIntakeMessage`); it exists to keep unbounded payloads
 * away from Guild and from the session-history parser that reads them back.
 */
export const MKTG_CHAT_MESSAGE_MAX_CHARS = 200_000;

/** History never renders provider-qualified subjects as staff display names. */
export const MKTG_HISTORY_SUBJECT_PATTERN = /\b(?:auth0|oidc|google-oauth2|github|samlp|waad|email|sms)\|[A-Za-z0-9._:@+/-]+/g;
