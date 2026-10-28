// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import { MKTG_OS_AGENTS_ROUTE_SEGMENT } from '../constants/mktg-os-agents.constants';

/** Keep the lens host, but match only a whole segment and discard query/fragment state. */
export function mktgKitRootPath(url: string): string {
  const segments = url.split(/[?#]/)[0].split('/');
  const index = segments.indexOf(MKTG_OS_AGENTS_ROUTE_SEGMENT);
  return index < 0 ? `/${MKTG_OS_AGENTS_ROUTE_SEGMENT}` : segments.slice(0, index + 1).join('/');
}

/** Sentence labels preserve acronyms and mixed-case names such as FAQ, ICP and LinkedIn. */
export function mktgSentenceCaseLabel(label: string): string {
  return label.replace(/^[A-Z][a-z]+\b/, (word) => word.charAt(0).toLowerCase() + word.slice(1));
}

/** All Run again links target the catalog's run page, without document-only state. */
export function mktgRunRouteFor(agentKey: string, basePath: string): string[] | undefined {
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === agentKey);
  return type?.catalogAgentId ? [basePath, type.catalogAgentId] : undefined;
}
