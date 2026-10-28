// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_AGENTS } from '../constants/mktg-os-agents.constants';
import { MKTG_AGENT_INTAKES } from '../constants/mktg-run.constants';
import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import { MKTG_FAMILY_ONE_OFF_RUN_MODES, MKTG_FAMILY_WRITE_REQUIRED } from '../constants/mktg-family-actions.constants';
import {
  MKTG_KIT_EXCLUDED_AGENT_IDS,
  MKTG_KIT_FRAMEWORK_AGENT_ID,
  MKTG_KIT_POSITIONING_FAMILY_ID,
  MKTG_KIT_STATE_LABELS,
} from '../constants/mktg-kit.constants';
import { MKTG_RUN_NEW_MODE } from '../constants/mktg-last-intake.constants';
import type { MktgFamilyActionContext, MktgFamilyActions, MktgFamilyRunAction } from '../interfaces/mktg-family-actions.interface';
import type { MktgKitFamilyView } from '../interfaces/mktg-kit.interface';

/** Catalog availability is shared by canonical row states and action selection. */
export function isMktgFamilyAgentAvailable(agentId: string): boolean {
  return (
    !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(agentId) &&
    !!MKTG_AGENT_INTAKES[agentId] &&
    MKTG_AGENTS.some((agent) => agent.id === agentId && agent.status === 'active')
  );
}

/** One policy for Family actions and Kit card data. Does not mutate the supplied view. */
export function resolveMktgFamilyActions(view: MktgKitFamilyView, context: MktgFamilyActionContext): MktgFamilyActions {
  const rows: MktgFamilyActions['rows'] = {};
  const approved = new Set(context.approvedSourceAgentIds ?? []);
  if (context.approvedFramework) approved.add(MKTG_KIT_FRAMEWORK_AGENT_ID);
  for (const row of view.rows) {
    const pointer = row.document?.approvedCurrent;
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === row.asset.agentKey);
    if (type?.catalogAgentId && pointer && pointer.revisionId.trim() && Number.isSafeInteger(pointer.number) && pointer.number > 0)
      approved.add(type.catalogAgentId);
  }
  const blockedReason = (agentId: string): string => {
    if (!context.canWrite) return MKTG_FAMILY_WRITE_REQUIRED;
    const attachment = MKTG_AGENT_INTAKES[agentId]?.attachments?.find(
      (item) => item.format === 'json' && !item.optional && !approved.has(item.sourceAgentId ?? '')
    );
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === agentId);
    return attachment ? `Approve the ${attachment.documentName.toLowerCase()} first: ${agent?.name ?? agentId} builds on the approved one.` : '';
  };
  const modeFor = (agentId: string): 'new' | null => {
    if (MKTG_DOCUMENT_TYPES.some((type) => type.catalogAgentId === agentId && type.kind === 'living')) return MKTG_RUN_NEW_MODE;
    return MKTG_FAMILY_ONE_OFF_RUN_MODES[agentId] ?? null;
  };
  for (const row of view.rows) {
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === row.asset.agentKey);
    const agentId = type?.catalogAgentId;
    if (!agentId || !isMktgFamilyAgentAvailable(agentId)) {
      rows[row.asset.id] = { row: { ...row, state: 'coming-soon', badge: MKTG_KIT_STATE_LABELS['coming-soon'] }, action: null };
      continue;
    }
    const action: MktgFamilyRunAction = {
      kind: row.document ? 'run-again' : 'run',
      label: row.document ? 'Run again' : `Run ${row.asset.runName ?? row.asset.label}`,
      agentId,
      mode: modeFor(agentId),
      blockedReason: blockedReason(agentId),
    };
    rows[row.asset.id] = { row, action };
  }
  if (!context.loaded) return { header: null, rows };
  if (view.family.id === MKTG_KIT_POSITIONING_FAMILY_ID && view.rows.some((row) => row.state === 'needs-rebuild')) {
    return {
      rows,
      header: {
        kind: 'rebuild',
        label: 'Rebuild what is stale',
        nextAssetLabel: '',
        agentId: null,
        mode: null,
        blockedReason: context.canWrite ? '' : MKTG_FAMILY_WRITE_REQUIRED,
      },
    };
  }
  const next = Object.values(rows).find(({ row, action }) => !row.document && action);
  if (next?.action) return { rows, header: { ...next.action, kind: 'run-next', label: 'Run next agent', nextAssetLabel: next.row.asset.label } };
  const agentId = view.family.agentIds[0];
  if (!agentId) return { rows, header: null };
  const available = isMktgFamilyAgentAvailable(agentId);
  const agent = MKTG_AGENTS.find((candidate) => candidate.id === agentId);
  const leadAsset = view.family.assets.find((asset) => MKTG_DOCUMENT_TYPES.some((type) => type.agentKey === asset.agentKey && type.catalogAgentId === agentId));
  const name = leadAsset?.runName ?? leadAsset?.label ?? view.family.pendingAgentName ?? agent?.name ?? agentId;
  const unavailableName = view.family.pendingAgentName ?? name;
  let leadBlocked = view.family.pendingAgentReason ?? MKTG_KIT_STATE_LABELS['coming-soon'];
  if (available || !context.canWrite) leadBlocked = blockedReason(agentId);
  return {
    rows,
    header: {
      kind: 'run-lead',
      label: `Run ${available ? name : unavailableName}`,
      nextAssetLabel: '',
      agentId,
      mode: modeFor(agentId),
      blockedReason: leadBlocked,
    },
  };
}
