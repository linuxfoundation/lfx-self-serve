// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import { MKTG_KIT_FAMILIES, MKTG_KIT_POSITIONING_FAMILY_ID, MKTG_KIT_TABS } from '../constants/mktg-kit.constants';
import { MKTG_AGENTS } from '../constants/mktg-os-agents.constants';
import type { MktgBreadcrumbItem, MktgBreadcrumbPage } from '../interfaces/mktg-breadcrumb.interface';

/** Absolute, fixed parents: reaching an asset from Documents never changes its family. */
export function buildMktgBreadcrumbs(page: MktgBreadcrumbPage, kitRootPath: string, projectName: string): MktgBreadcrumbItem[] {
  if (page.kind === 'kit') return [];
  const root: MktgBreadcrumbItem = { label: projectName ? `${projectName} kit` : 'Marketing kit', route: [kitRootPath] };
  if (page.kind === 'kit-tab') {
    return [root, { label: MKTG_KIT_TABS.find((tab) => tab.path === page.tab)?.label ?? '' }];
  }
  if (page.kind === 'family') {
    return [root, { label: MKTG_KIT_FAMILIES.find((family) => family.id === page.familyId)?.name ?? 'Family not found' }];
  }

  const key = page.kind === 'asset' ? page.agentKey : page.agentId;
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === key || entry.catalogAgentId === key);
  const family = MKTG_KIT_FAMILIES.find(
    (entry) => entry.assets.some((asset) => asset.agentKey === key) || entry.agentIds.includes(type?.catalogAgentId ?? key)
  );
  // ICP is a legacy Documents asset, but its navigation parent remains Positioning & brand.
  const parent = family ?? (key === 'icp' ? MKTG_KIT_FAMILIES.find((entry) => entry.id === MKTG_KIT_POSITIONING_FAMILY_ID) : undefined);
  const defaultLabel = page.kind === 'asset' ? (type?.itemLabel ?? 'Document') : (MKTG_AGENTS.find((agent) => agent.id === key)?.name ?? 'Agent');
  return [
    root,
    parent ? { label: parent.name, route: [kitRootPath, 'families', parent.id] } : { label: 'Documents', route: [kitRootPath, 'documents'] },
    { label: page.label ?? defaultLabel },
  ];
}
