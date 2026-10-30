// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_AGENTS } from '../constants/mktg-os-agents.constants';
import { MKTG_AGENT_INTAKES } from '../constants/mktg-run.constants';
import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import {
  MKTG_FAMILY_ACTION_LABELS,
  MKTG_FAMILY_FRAMEWORK_REQUIRED,
  MKTG_FAMILY_ONE_OFF_RUN_MODES,
  MKTG_FAMILY_WRITE_REQUIRED,
} from '../constants/mktg-family-actions.constants';
import { mktgFamilyExportAgentKeys } from './mktg-family-export.utils';
import {
  MKTG_KIT_EXCLUDED_AGENT_IDS,
  MKTG_KIT_FRAMEWORK_AGENT_ID,
  MKTG_KIT_POSITIONING_FAMILY_ID,
  MKTG_KIT_STATE_LABELS,
} from '../constants/mktg-kit.constants';
import { MKTG_RUN_NEW_MODE } from '../constants/mktg-last-intake.constants';
import type { MktgFamilyActionContext, MktgFamilyActions, MktgFamilyHeaderAction, MktgFamilyNextStep } from '../interfaces/mktg-family-actions.interface';
import type { MktgKitAssetRow, MktgKitFamilyView } from '../interfaces/mktg-kit.interface';
import type { MktgDocumentRunProgress } from '../interfaces/mktg-document-run.interface';
import type { MktgDocumentListItem } from '../interfaces/mktg-document-store.interface';

/** Optional run overlay only; stored-asset actions and Kit Next step keep their existing policy. Links are relative to the Kit root. */
export function resolveMktgFamilyRun(
  agentKey: string | null | undefined,
  runs: readonly MktgDocumentRunProgress[] = [],
  prefix: string[] = [],
  document?: MktgDocumentListItem | null
): Pick<MktgFamilyHeaderAction, 'label' | 'caption' | 'link'> | null {
  const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === agentKey);
  if (!type?.catalogAgentId || !isMktgFamilyAgentAvailable(type.catalogAgentId)) return null;
  const run = runs
    .filter((candidate) => candidate.agentKey === agentKey && candidate.state !== 'failed')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!run) return null;
  const approved = document?.approvedCurrent;
  const approvedDocument =
    type.kind === 'living' &&
    document?.agentKey === run.agentKey &&
    document.documentId === run.documentId &&
    approved &&
    Number.isSafeInteger(approved.number) &&
    approved.number > 0 &&
    typeof approved.revisionId === 'string' &&
    approved.revisionId.trim().length > 0;
  let caption = approvedDocument ? 'Approved · new version being written' : 'Writing…';
  if (type.kind !== 'living') caption = 'In progress…';
  if (run.state === 'questions') caption = 'Waiting for your answers';
  return {
    label: run.state === 'questions' ? 'Answer the questions' : 'Open',
    caption,
    // B2 seam: move writing to the run-page receiver here; all questions already use their catalog run page.
    link:
      run.state === 'questions'
        ? { commands: [...prefix, type.catalogAgentId], queryParams: {} }
        : { commands: [...prefix, 'documents', run.agentKey, run.documentId], queryParams: { run: run.runId } },
  };
}

/** Catalog availability is shared by canonical row states and action selection. */
export function isMktgFamilyAgentAvailable(agentId: string): boolean {
  return (
    !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(agentId) &&
    !!MKTG_AGENT_INTAKES[agentId] &&
    MKTG_AGENTS.some((agent) => agent.id === agentId && agent.status === 'active')
  );
}

/** Shared entry mode for Family and document Run again; independent of document-only selectors. */
export function mktgRunModeFor(agentId: string): 'new' | null {
  if (MKTG_DOCUMENT_TYPES.some((type) => type.catalogAgentId === agentId && type.kind === 'living')) return MKTG_RUN_NEW_MODE;
  return MKTG_FAMILY_ONE_OFF_RUN_MODES[agentId] ?? null;
}

/** The ONE place to flip row-action policy: existing assets use their document's Run again entry. */
export function mktgFamilyRowAction(row: MktgKitAssetRow, ctx: MktgFamilyActionContext): MktgFamilyActions['rows'][string] {
  const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === row.asset.agentKey);
  const agentId = type?.catalogAgentId;
  if (!type || !agentId || !isMktgFamilyAgentAvailable(agentId))
    return { row: { ...row, state: 'coming-soon', badge: MKTG_KIT_STATE_LABELS['coming-soon'] }, action: null };
  if (row.document) return { row, action: null };
  const dependency = missingDependency(agentId, ctx);
  const agent = MKTG_AGENTS.find((candidate) => candidate.id === agentId);
  let blockedReason = '';
  if (dependency)
    blockedReason =
      dependency.sourceAgentId === MKTG_KIT_FRAMEWORK_AGENT_ID
        ? MKTG_FAMILY_FRAMEWORK_REQUIRED
        : `Approve the ${dependency.documentName.toLowerCase()} first: ${agent?.name ?? agentId} builds on the approved one.`;
  if (!ctx.canWrite) blockedReason = MKTG_FAMILY_WRITE_REQUIRED;
  return {
    row,
    action: {
      kind: 'run',
      label: MKTG_FAMILY_ACTION_LABELS.create(row.asset.runName ?? (type.kind === 'run' ? row.asset.label : row.asset.label.toLowerCase())),
      agentId,
      mode: mktgRunModeFor(agentId),
      blockedReason,
    },
  };
}

/** One policy for Family actions and Kit card data. Does not mutate the supplied view. */
export function resolveMktgFamilyActions(view: MktgKitFamilyView, context: MktgFamilyActionContext): MktgFamilyActions {
  const rows: MktgFamilyActions['rows'] = {};
  const approved = new Set(context.approvedSourceAgentIds ?? []);
  if (context.approvedFramework) approved.add(MKTG_KIT_FRAMEWORK_AGENT_ID);
  for (const row of view.rows) {
    const pointer = row.document?.approvedCurrent;
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === row.asset.agentKey);
    if (
      type?.catalogAgentId &&
      pointer &&
      typeof pointer.revisionId === 'string' &&
      pointer.revisionId.trim() &&
      Number.isSafeInteger(pointer.number) &&
      pointer.number > 0
    )
      approved.add(type.catalogAgentId);
  }
  const ctx = { ...context, approvedSourceAgentIds: [...approved] };
  for (const row of view.rows) rows[row.asset.id] = mktgFamilyRowAction(row, ctx);
  if (!context.loaded || !context.canWrite) return { header: null, rows };
  const stale = Object.values(rows)
    .map((entry) => entry.row)
    .filter((row) => row.state === 'needs-rebuild');
  if (view.family.id === MKTG_KIT_POSITIONING_FAMILY_ID && stale.length) {
    return {
      rows,
      header: {
        kind: 'rebuild',
        label: MKTG_FAMILY_ACTION_LABELS.rebuild(stale.map((row) => row.asset.runName ?? row.asset.label)),
        agentId: null,
        mode: null,
        link: null,
      },
    };
  }
  const documentLink = (row: MktgKitAssetRow | undefined): MktgFamilyHeaderAction['link'] =>
    row?.document && row.asset.agentKey ? { commands: ['../../documents', row.asset.agentKey, row.document.documentId], queryParams: {} } : null;
  const next = Object.values(rows).find(({ action }) => action);
  if (next?.action) {
    const dependency = missingDependency(next.action.agentId, ctx);
    if (dependency) {
      const source = MKTG_DOCUMENT_TYPES.find((type) => type.catalogAgentId === dependency.sourceAgentId);
      const link = documentLink(view.rows.find((row) => row.asset.agentKey === source?.agentKey));
      // The framework's stable living route also works when this is another family.
      const commands = source ? ['../../documents', source.agentKey, 'living'] : null;
      if (!link && !commands) return { rows, header: null };
      return {
        rows,
        header: {
          kind: 'blocked',
          label: MKTG_FAMILY_ACTION_LABELS.blocked(dependency.documentName),
          caption: MKTG_FAMILY_ACTION_LABELS.caption(
            Object.values(rows)
              .filter(({ action }) => action)
              .map(({ row }) => row.asset.captionName ?? row.asset.runName ?? row.asset.label.toLowerCase())
          ),
          agentId: null,
          mode: null,
          link: link ?? { commands: commands ?? [], queryParams: {} },
        },
      };
    }
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === next.action?.agentId);
    return {
      rows,
      header: {
        kind: 'create',
        label: MKTG_FAMILY_ACTION_LABELS.create(next.row.asset.runName ?? next.row.asset.label),
        agentId: next.action.agentId,
        mode: type?.kind === 'living' ? MKTG_RUN_NEW_MODE : null,
        link: null,
      },
    };
  }
  const lead = MKTG_DOCUMENT_TYPES.find((type) => type.catalogAgentId === view.family.agentIds[0]);
  if (lead?.kind === 'run' && lead.catalogAgentId && isMktgFamilyAgentAvailable(lead.catalogAgentId))
    return {
      rows,
      header: {
        kind: 'create',
        label: MKTG_FAMILY_ACTION_LABELS.create(
          view.family.assets.find((asset) => asset.agentKey === lead.agentKey)?.runName ??
            view.family.assets.find((asset) => asset.agentKey === lead.agentKey)?.label ??
            lead.itemLabel
        ),
        agentId: lead.catalogAgentId,
        mode: null,
        link: null,
      },
    };
  const drafts = Object.values(rows).filter(({ row }) => row.state === 'draft' && row.document);
  const link = documentLink(drafts[0]?.row);
  if (link) return { rows, header: { kind: 'review', label: MKTG_FAMILY_ACTION_LABELS.review(drafts.length), agentId: null, mode: null, link } };
  const available = Object.values(rows).filter(({ row }) => row.state !== 'coming-soon');
  const exportable =
    mktgFamilyExportAgentKeys(view.family.id).length > 0 && available.length > 0 && available.every(({ row }) => row.document && row.state === 'approved');
  return { rows, header: exportable ? { kind: 'export', label: MKTG_FAMILY_ACTION_LABELS.export(), agentId: null, mode: null, link: null } : null };
}

/** Present the existing family policy, never select a second action independently of its header. */
export function resolveMktgFamilyNextStep(view: MktgKitFamilyView, ctx: MktgFamilyActionContext): MktgFamilyNextStep | null {
  if (!view.live) return null;
  const actions = resolveMktgFamilyActions(view, ctx);
  const header = actions.header;
  if (!header) return null;
  const rows = Object.values(actions.rows).map((entry) => entry.row);
  const target =
    rows.find((row) => header.link && row.asset.agentKey === header.link.commands[1]) ??
    rows.find((row) => MKTG_DOCUMENT_TYPES.some((type) => type.agentKey === row.asset.agentKey && type.catalogAgentId === header.agentId));
  const asset = target?.asset.runName ?? target?.asset.label.toLowerCase();
  const commands =
    header.link?.commands.map((command) => (command === '../../documents' ? 'documents' : command)) ??
    (header.agentId ? [header.agentId] : ['families', view.family.id]);
  let sentence = header.label;
  if (header.kind === 'create' && asset) {
    sentence = rows.some((row) => row.document) ? `Create the ${asset} next.` : `Nothing in the kit yet; create the ${asset} to start.`;
  } else if ((header.kind === 'review' || header.kind === 'blocked') && target?.state === 'draft' && asset) {
    const dependants = rows
      .slice(rows.indexOf(target) + 1)
      .filter((row) => row.state !== 'coming-soon' && !row.document)
      .map((row) => row.asset.runName ?? row.asset.label.toLowerCase());
    const names = dependants.length > 1 ? `${dependants.slice(0, -1).join(', ')} and the ${dependants.at(-1)}` : dependants[0];
    sentence = `The ${asset} is drafted; approve it${names ? ` so ${names} can be created` : ''}.`;
  } else if (header.kind === 'blocked') {
    sentence = Object.values(actions.rows).find((entry) => entry.action?.blockedReason)?.action?.blockedReason ?? header.label;
  } else if (header.kind === 'rebuild') {
    const count = rows.filter((row) => row.state === 'needs-rebuild').length;
    sentence = `${count} ${count === 1 ? 'asset is' : 'assets are'} stale; rebuild ${count === 1 ? 'it' : 'them'}.`;
  } else if (header.kind === 'export') {
    sentence = `${view.family.name} is complete; export it.`;
  }
  let hint = `Opens ${view.family.name}, where the stale assets are rebuilt.`;
  if (header.kind === 'export') hint = `Opens ${view.family.name} for export.`;
  if (header.link)
    hint = `Opens the ${header.kind === 'blocked' && asset === 'messaging framework' ? 'framework' : (asset ?? 'required')} document in ${view.family.name}.`;
  else if (header.agentId) hint = `Opens the ${asset ?? 'asset'} run page in ${view.family.name}.`;
  return { header, commands, queryParams: header.link?.queryParams ?? (header.mode ? { mode: header.mode } : {}), sentence, hint };
}

function missingDependency(agentId: string, ctx: MktgFamilyActionContext) {
  return MKTG_AGENT_INTAKES[agentId]?.attachments?.find(
    (item) =>
      item.format === 'json' &&
      !item.optional &&
      !(item.sourceAgentId === MKTG_KIT_FRAMEWORK_AGENT_ID && ctx.approvedFramework) &&
      !ctx.approvedSourceAgentIds?.includes(item.sourceAgentId ?? '')
  );
}
