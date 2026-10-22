// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type { MktgDocumentAgentKey } from '../interfaces/mktg-document-store.interface';
import type { MktgKitFamily, MktgKitFilter } from '../interfaces/mktg-kit.interface';

export const MKTG_KIT_POSITIONING_FAMILY_ID = 'positioning-brand';
export const MKTG_KIT_FRAMEWORK_AGENT_ID = 'foundation-setup';
export const MKTG_KIT_FRAMEWORK_KEY = 'foundation-message';
/** ICPs are the framework's icp section, not a kit asset; legacy documents remain in Documents only. */
export const MKTG_KIT_EXCLUDED_DOCUMENT_KEYS: MktgDocumentAgentKey[] = ['icp'];
/** Standalone ICP and Website Builder are not kit agents. */
export const MKTG_KIT_EXCLUDED_AGENT_IDS = ['icp', 'website-builder'];

export const MKTG_KIT_LABELS = {
  title: 'Marketing kit',
  description: 'Every asset the project runs on: current, approved and one click away.',
} as const;

/** Main board order: four live families first, then the five unbuilt families. */
export const MKTG_KIT_FAMILIES: MktgKitFamily[] = [
  {
    id: MKTG_KIT_POSITIONING_FAMILY_ID,
    name: 'Positioning & brand',
    lead: 'agents',
    leadSummary: 'Messaging Framework, Boilerplates, FAQ, Brand Kit',
    description: 'The messaging framework, boilerplates, FAQ and brand kit.',
    intro: 'The framework comes first; boilerplates, FAQ and the brand kit read it. Any asset, or the whole family, exports to PDF or Google Slides.',
    assets: [
      {
        id: 'messaging-framework',
        label: 'Messaging framework',
        agentKey: 'foundation-message',
        description: 'Vision, mission, positioning, tagline, goals, say and avoid · with ICPs, message house and key numbers',
      },
      { id: 'boilerplates', label: 'Boilerplates', agentKey: 'boilerplates', description: 'One-liner, 25, 50 and 100 words' },
      { id: 'faq', label: 'FAQ', agentKey: 'faq', description: 'Questions answered from the sources; unanswered questions flagged' },
      { id: 'brand-kit', label: 'Brand kit', agentKey: 'brand-kit', description: 'Colours, typeface, logo system, voice · the book as a print page' },
      { id: 'one-pager', label: 'One pager', description: 'Message house and the 50-word boilerplate on one page' },
    ],
    agentIds: ['foundation-setup', 'boilerplates', 'faq', 'brand-kit'],
    runOrder: 'Run in order: framework first, then the three that read it',
  },
  {
    id: 'website-web',
    name: 'Website & web',
    lead: 'HUB',
    leadSummary: 'AEO/GEO agent',
    description: 'How the project’s site reads to answer engines; a scorecard and a report.',
    assets: [{ id: 'aeo-geo', label: 'AEO/GEO scorecard', agentKey: 'aeo-geo', description: 'How the project’s site reads to answer engines' }],
    agentIds: ['aeo-geo'],
    runOrder: '',
  },
  {
    id: 'social-community',
    name: 'Social & community',
    lead: 'HUB voices',
    leadSummary: 'LinkedIn Post agent',
    description: 'Posts in the project’s voice from a link or a note.',
    assets: [{ id: 'linkedin-post', label: 'LinkedIn posts', agentKey: 'linkedin-post', description: 'Posts in your project voice' }],
    agentIds: ['linkedin-post'],
    runOrder: '',
  },
  {
    id: 'member-sponsor',
    name: 'Member & sponsor kit',
    lead: 'sales',
    leadSummary: 'Member 360 agent',
    description: 'Who to talk to at a member company and why, from LFX and the web.',
    assets: [
      { id: 'member-360', label: 'Member 360', agentKey: 'member-360', description: 'Member company research from LFX and the web' },
      { id: 'pitch-deck', label: 'Pitch deck', description: 'A sponsor-ready pitch deck' },
    ],
    agentIds: ['member-360', 'pitch-deck'],
    pendingAgentName: 'Member 360',
    pendingAgentReason: 'Coming soon — the Member 360 page is on its way',
    runOrder: '',
  },
  {
    id: 'plan-committee-measurement',
    name: 'Plan, committee & measurement',
    lead: 'agents',
    description: 'Quarterly plan and scorecard.',
    assets: [{ id: 'quarterly-plan', label: 'Quarterly plan', description: 'Goals, owners and milestones' }],
    agentIds: ['qtrly-plan'],
    runOrder: '',
  },
  {
    id: 'lists-newsletter',
    name: 'Lists & newsletter',
    lead: 'HUB lifecycle',
    description: 'Newsletter and lists, with LFX Newsletters.',
    assets: [],
    agentIds: [],
    runOrder: '',
  },
  { id: 'content-video', name: 'Content & video', lead: 'HUB', description: 'Talk clips and content.', assets: [], agentIds: [], runOrder: '' },
  {
    id: 'pr-analyst-launch',
    name: 'PR, analyst & launch',
    lead: 'HUB newsroom',
    description: 'Press kit and launches.',
    assets: [],
    agentIds: [],
    runOrder: '',
  },
  { id: 'events', name: 'Events', lead: 'events', description: 'Event calendar, with LFX Events.', assets: [], agentIds: [], runOrder: '' },
];

export const MKTG_KIT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'approved', label: 'Approved' },
  { id: 'draft', label: 'Draft' },
  { id: 'needs-rebuild', label: 'Needs rebuild' },
  { id: 'missing', label: 'Not run yet' },
] satisfies (FilterPillOption & { id: MktgKitFilter })[];
export const MKTG_KIT_STATE_LABELS = {
  approved: 'Approved',
  draft: 'Draft',
  'needs-rebuild': 'Needs rebuild',
  missing: 'Not run yet',
  'coming-soon': 'Coming soon',
} as const;
export const MKTG_KIT_TABS = [
  { path: '', label: 'Kit' },
  { path: 'requests', label: 'Requests' },
  { path: 'access', label: 'Access' },
  { path: 'documents', label: 'Documents' },
] as const;
