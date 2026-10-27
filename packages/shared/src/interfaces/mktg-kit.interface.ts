// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgAgent, MktgAgentTile } from './mktg-agent.interface';
import type { MktgDocumentAgentKey, MktgDocumentListItem } from './mktg-document-store.interface';

export type MktgKitAssetState = 'approved' | 'draft' | 'needs-rebuild' | 'missing' | 'coming-soon';
export type MktgKitFilter = 'all' | Exclude<MktgKitAssetState, 'coming-soon'>;

export interface MktgKitAsset {
  id: string;
  label: string;
  /** Board action wording when its sentence case differs from the row heading. */
  runName?: string;
  description: string;
  agentKey?: MktgDocumentAgentKey;
}

export interface MktgKitFamily {
  id: string;
  name: string;
  lead: string;
  /** Board copy for the lead line, including planned assets, not runnable catalog membership. */
  leadSummary?: string;
  description: string;
  intro?: string;
  assets: MktgKitAsset[];
  /**
   * Agent ids in run order: catalog ids, plus ids declared ahead of their catalog entry.
   * Availability and routing come from MKTG_AGENTS; Family Run action wording comes
   * from the matching asset/pending copy. An unregistered id renders no agent tile
   * and keeps the Family header's Run action disabled.
   */
  agentIds: string[];
  /** Header-only copy for a declared first agent that is unavailable or not yet registered. */
  pendingAgentName?: string;
  pendingAgentReason?: string;
  /** Only a family with board-provided guidance displays a run-order sentence. */
  runOrder?: string;
}

export interface MktgKitAssetRow {
  asset: MktgKitAsset;
  /** Already-run one-offs have no approval state; never-run and unavailable ones still have states. */
  state: MktgKitAssetState | null;
  version: number | null;
  monthlyCount: number | null;
  document: MktgDocumentListItem | null;
  madeBy: string;
  badge: string;
}

export interface MktgKitFamilyView {
  family: MktgKitFamily;
  live: boolean;
  rows: MktgKitAssetRow[];
  agents: MktgAgent[];
}

export interface MktgKitSummary {
  level: 'Core' | null;
  coreFloor: number;
  inKit: number;
}

export interface MktgKitAgentTile extends MktgAgentTile {
  statusLabel: string;
  lastRunAt: string | null;
}

export interface MktgKitAgentGroup {
  family: MktgKitFamily;
  tiles: MktgKitAgentTile[];
}

export interface MktgKitSourcesView {
  readCount: number;
  failedCount: number;
  readText: string;
  failedText: string;
}
