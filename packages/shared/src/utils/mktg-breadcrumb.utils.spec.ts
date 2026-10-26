// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_AGENTS } from '../constants/mktg-os-agents.constants';
import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import { MKTG_KIT_TABS } from '../constants/mktg-kit.constants';
import type { MktgBreadcrumbPage, MktgKitTabPath } from '../interfaces/mktg-breadcrumb.interface';
import { buildMktgBreadcrumbs } from './mktg-breadcrumb.utils';

describe.each(['/project/mktg-os-agents', '/foundation/mktg-os-agents'])('breadcrumb table at %s', (root) => {
  const cases: { route: string; page: MktgBreadcrumbPage; labels: string[]; parents: string[][] }[] = [
    { route: '', page: { kind: 'kit' }, labels: [], parents: [] },
    ...MKTG_KIT_TABS.flatMap(({ path: tab, label }) =>
      tab
        ? [
            {
              route: `/${tab}`,
              page: { kind: 'kit-tab' as const, tab },
              labels: ['Synthetic kit', label],
              parents: [[root]],
            },
          ]
        : []
    ),
    {
      route: '/unknown-tab',
      page: { kind: 'kit-tab', tab: 'unknown-tab' as MktgKitTabPath },
      labels: ['Synthetic kit', 'Tab not found'],
      parents: [[root]],
    },
    {
      route: '/families/positioning-brand',
      page: { kind: 'family', familyId: 'positioning-brand' },
      labels: ['Synthetic kit', 'Positioning & brand'],
      parents: [[root]],
    },
    { route: '/families/missing', page: { kind: 'family', familyId: 'missing' }, labels: ['Synthetic kit', 'Family not found'], parents: [[root]] },
    // Page identity carries no entry route: family and Documents entry share this row.
    {
      route: '/documents/foundation-message/living',
      page: { kind: 'asset', agentKey: 'foundation-message' },
      labels: ['Synthetic kit', 'Positioning & brand', 'Messaging framework'],
      parents: [[root], [root, 'families', 'positioning-brand']],
    },
    {
      route: '/documents/icp/living',
      page: { kind: 'asset', agentKey: 'icp' },
      labels: ['Synthetic kit', 'Positioning & brand', 'ICP & Target Markets'],
      parents: [[root], [root, 'families', 'positioning-brand']],
    },
    {
      route: '/documents/legacy-output/living',
      page: { kind: 'asset', agentKey: 'legacy-output', label: 'Legacy asset' },
      labels: ['Synthetic kit', 'Documents', 'Legacy asset'],
      parents: [[root], [root, 'documents']],
    },
    {
      route: '/documents/aeo-geo/run-synthetic',
      page: { kind: 'asset', agentKey: 'aeo-geo', label: 'AEO/GEO report · 23 Oct 2026' },
      labels: ['Synthetic kit', 'Website & web', 'AEO/GEO report · 23 Oct 2026'],
      parents: [[root], [root, 'families', 'website-web']],
    },
    ...MKTG_AGENTS.map((agent) => {
      const families: Record<string, [string, string]> = {
        'foundation-setup': ['Positioning & brand', 'positioning-brand'],
        'brand-kit': ['Positioning & brand', 'positioning-brand'],
        boilerplates: ['Positioning & brand', 'positioning-brand'],
        faq: ['Positioning & brand', 'positioning-brand'],
        icp: ['Positioning & brand', 'positioning-brand'],
        'linkedin-post': ['Social & community', 'social-community'],
        'member-360': ['Member & sponsor kit', 'member-sponsor'],
        'aeo-geo': ['Website & web', 'website-web'],
        'pitch-deck': ['Member & sponsor kit', 'member-sponsor'],
        'qtrly-plan': ['Plan, committee & measurement', 'plan-committee-measurement'],
      };
      const family = families[agent.id];
      const living = MKTG_DOCUMENT_TYPES.find((type) => type.catalogAgentId === agent.id && type.kind === 'living');
      return {
        route: `/${agent.id}`,
        page: { kind: 'run' as const, agentId: agent.id },
        labels: ['Synthetic kit', family?.[0] ?? 'Documents', living?.itemLabel ?? agent.name],
        parents: [[root], family ? [root, 'families', family[1]] : [root, 'documents']],
      };
    }),
    { route: '/unknown', page: { kind: 'run', agentId: 'unknown' }, labels: ['Synthetic kit', 'Documents', 'Agent'], parents: [[root], [root, 'documents']] },
  ];
  it.each(cases)('$route has fixed absolute parents and catalog labels', ({ page, labels, parents }) => {
    const crumbs = buildMktgBreadcrumbs(page, root, 'Synthetic');
    expect(crumbs.map((crumb) => crumb.label)).toEqual(labels);
    expect(crumbs.flatMap((crumb) => (crumb.route ? [crumb.route] : []))).toEqual(parents);
    if (crumbs.length) expect(crumbs.at(-1)?.route).toBeUndefined();
  });
  it('uses one neutral unresolved-project label and allows a run label override', () => {
    expect(buildMktgBreadcrumbs({ kind: 'run', agentId: 'foundation-setup', label: 'Run custom' }, root, '')).toEqual([
      { label: 'Marketing kit', route: [root] },
      { label: 'Positioning & brand', route: [root, 'families', 'positioning-brand'] },
      { label: 'Run custom' },
    ]);
  });
});
