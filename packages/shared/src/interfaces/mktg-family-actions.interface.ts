// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgKitAssetRow } from './mktg-kit.interface';

export interface MktgFamilyActionContext {
  loaded: boolean;
  canWrite: boolean;
  approvedFramework: boolean;
  /** Approved dependencies outside this family's rows, keyed by catalog agent id. */
  approvedSourceAgentIds?: readonly string[];
}

export interface MktgFamilyRunAction {
  kind: 'run';
  label: string;
  agentId: string;
  mode: 'new' | null;
  blockedReason: string;
}

export interface MktgFamilyHeaderAction {
  kind: 'rebuild' | 'blocked' | 'create' | 'review';
  label: string;
  agentId: string | null;
  mode: 'new' | null;
  link: { commands: string[]; queryParams: Record<string, string> } | null;
}

export interface MktgFamilyActions {
  header: MktgFamilyHeaderAction | null;
  rows: Record<string, { row: MktgKitAssetRow; action: MktgFamilyRunAction | null }>;
}
