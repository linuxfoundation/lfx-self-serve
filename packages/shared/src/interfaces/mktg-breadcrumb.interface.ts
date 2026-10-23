// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MKTG_KIT_TABS } from '../constants/mktg-kit.constants';

export type MktgKitTabPath = Exclude<(typeof MKTG_KIT_TABS)[number]['path'], ''>;

/** Page identity only: the shared builder owns labels, parents and absolute links. */
export type MktgBreadcrumbPage =
  | { kind: 'kit' }
  | { kind: 'kit-tab'; tab: MktgKitTabPath }
  | { kind: 'family'; familyId: string }
  | { kind: 'asset'; agentKey: string; label?: string }
  | { kind: 'run'; agentId: string; label?: string };

/** Fixed-parent navigation, independent of the path used to reach a screen. */
export interface MktgBreadcrumbItem {
  label: string;
  route?: string[];
  queryParams?: Record<string, string | null>;
}
