// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import { MKTG_KIT_FAMILIES, MKTG_KIT_POSITIONING_FAMILY_ID } from '../constants/mktg-kit.constants';
import { MKTG_OS_AGENTS_ROUTE_SEGMENT } from '../constants/mktg-os-agents.constants';
import type { MktgBreadcrumbItem } from '../interfaces/mktg-breadcrumb.interface';

/** Keep the lens host, but never copy query strings or fragments into a parent link. */
export function mktgKitRootPath(url: string): string {
  const path = url.split(/[?#]/)[0];
  const index = path.indexOf(MKTG_OS_AGENTS_ROUTE_SEGMENT);
  return index < 0 ? `/${MKTG_OS_AGENTS_ROUTE_SEGMENT}` : path.slice(0, index + MKTG_OS_AGENTS_ROUTE_SEGMENT.length);
}

/** The Kit root's label and optional parent target, shared by every breadcrumb. */
export function mktgKitRootCrumb(projectName: string, route?: string[]): MktgBreadcrumbItem {
  return { label: `${projectName || 'Project'} kit`, ...(route ? { route } : {}) };
}

/** Accept either a document-store key or a catalog id (the framework's differ). */
export function mktgKitCrumbsFor(agentKey: string, projectName: string, basePath: string, label: string): MktgBreadcrumbItem[] {
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === agentKey || entry.catalogAgentId === agentKey);
  const family = MKTG_KIT_FAMILIES.find(
    (entry) => entry.assets.some((asset) => asset.agentKey === agentKey) || entry.agentIds.includes(type?.catalogAgentId ?? agentKey)
  );
  // ICP remains a legacy Documents asset, but its fixed navigation parent is Positioning & brand.
  const parent = family ?? (agentKey === 'icp' ? MKTG_KIT_FAMILIES.find((entry) => entry.id === MKTG_KIT_POSITIONING_FAMILY_ID) : undefined);
  return [
    mktgKitRootCrumb(projectName, [basePath]),
    parent ? { label: parent.name, route: [basePath, 'families', parent.id] } : { label: 'Documents', route: [basePath, 'documents'] },
    { label },
  ];
}

/** All Run again links target the catalog's run page, without document-only state. */
export function mktgRunRouteFor(agentKey: string, basePath: string): string[] | undefined {
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === agentKey);
  return type?.catalogAgentId ? [basePath, type.catalogAgentId] : undefined;
}
