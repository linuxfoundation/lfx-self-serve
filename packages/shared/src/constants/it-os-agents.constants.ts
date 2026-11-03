// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ItOsAgent } from '../interfaces';

// Shared labels for IT OS (#4257): chat-first agents that help maintainers, program managers and
// executive directors with their project's IT setup. Centralized so the nav item, route and
// landing page stay in sync.
export const IT_OS_AGENTS_LABEL = {
  /** Sidebar nav entry, placed directly under Marketing OS. */
  nav: 'IT OS',
  title: 'LFX Project IT OS',
  description: 'Run LFX IT agents for your project.',
} as const;

/** Route segment (lens-prefixed at the route layer, e.g. /project/it-os-agents). */
export const IT_OS_AGENTS_ROUTE_SEGMENT = 'it-os-agents';

// IT OS agent catalog. UI only for now: agents work on sample data and make no upstream calls.
export const IT_OS_AGENTS: ItOsAgent[] = [
  {
    id: 'dns',
    name: 'Domains & DNS Agent',
    icon: 'fa-light fa-globe',
    color: 'blue',
    tags: ['Domains', 'DNS'],
    via: 'DNSimple',
    description:
      "Moves the project's domains to LF, one or many at a time, registers new ones, and changes DNS records. Catches transfer problems before they happen and answers questions across all your domains.",
  },
  {
    id: 'github',
    name: 'GitHub Org Agent',
    icon: 'fa-brands fa-github',
    color: 'emerald',
    tags: ['Repos', 'Access'],
    via: 'GitHub',
    description: 'Connects your GitHub org to LF, creates repos, brings existing repos into the org, and manages who has access.',
  },
  {
    id: 'forwarding',
    name: 'Email Forwarding Agent',
    icon: 'fa-light fa-share',
    color: 'amber',
    tags: ['Email', 'Forwarding'],
    via: 'Forward Email',
    description:
      "Sets up LF's standard project addresses on your primary domain: the required ones, plus any if-needed or optional ones the project wants. Fills in where they go from LFX.",
  },
  {
    id: 'mailing-lists',
    name: 'Mailing List Agent',
    icon: 'fa-light fa-list',
    color: 'violet',
    tags: ['Lists', 'Community'],
    via: 'groups.io',
    description: 'Creates groups.io lists, manages subscribers, and links lists to committees so membership stays in sync.',
  },
  {
    id: 'access-review',
    name: 'Access Review Agent',
    icon: 'fa-light fa-lock',
    color: 'gray',
    tags: ['Security', 'Access'],
    description: 'Reviews who has admin access across GitHub and lists, and flags accounts that look stale.',
    comingSoon: true,
  },
];
