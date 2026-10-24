// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { z } from 'zod';
import { MKTG_ARTIFACT_PARTITION_REGEX } from '../constants/mktg-artifact.constants';
import { MKTG_DOCUMENT_ID_REGEX, MKTG_REVISION_ID_REGEX, MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import { MKTG_KIT_FAMILIES } from '../constants/mktg-kit.constants';
import {
  MKTG_REQUESTS_SCHEMA,
  MKTG_REQUESTS_MAX,
  MKTG_REQUEST_TEXT_MAX,
  MKTG_REQUEST_KINDS,
  MKTG_REQUEST_STATES,
  MKTG_REQUEST_ID_REGEX,
  MKTG_REQUEST_MAX_STATE_CHANGES,
  MKTG_REQUEST_TARGET_ID_MAX,
  MKTG_REQUEST_WITHDRAWN_NOTE,
} from '../constants/mktg-requests.constants';
import type { MktgDocumentAgentKey } from '../interfaces/mktg-document-store.interface';
import type { MktgRequestTarget } from '../interfaces/mktg-requests.interface';

const projectSchema = z.string().regex(MKTG_ARTIFACT_PARTITION_REGEX);
const tokenSchema = z.string().regex(MKTG_REQUEST_ID_REGEX);
const identifierSchema = z
  .string()
  .min(1)
  .max(MKTG_REQUEST_TARGET_ID_MAX)
  .refine((id) => !!id.trim());
const textSchema = z
  .string()
  .max(MKTG_REQUEST_TEXT_MAX)
  .refine((text) => !!text.trim());
const targetShape = {
  familyId: identifierSchema,
  assetId: identifierSchema.optional(),
  agentKey: identifierSchema.optional(),
  documentId: z.string().regex(MKTG_DOCUMENT_ID_REGEX).optional(),
  revisionId: z.string().regex(MKTG_REVISION_ID_REGEX).optional(),
};
const linkedTarget = (target: MktgRequestTarget) => (!target.documentId || !!target.agentKey) && (!target.revisionId || !!target.documentId);
// Historical records are structural, never a foreign key into today's mutable catalog.
const storedTargetSchema = z.strictObject(targetShape).refine(linkedTarget, { path: ['documentId'] });
const currentAgentSchema = z.custom<MktgDocumentAgentKey>((key) => typeof key === 'string' && MKTG_DOCUMENT_TYPES.some((type) => type.agentKey === key));
const createTargetSchema = z
  .strictObject({ ...targetShape, agentKey: currentAgentSchema.optional() })
  .refine(linkedTarget, { path: ['documentId'] })
  .refine(
    (target) =>
      MKTG_KIT_FAMILIES.some(
        (family) =>
          family.id === target.familyId &&
          (!target.assetId || family.assets.some((asset) => asset.id === target.assetId && (!target.agentKey || asset.agentKey === target.agentKey))) &&
          (!target.agentKey || !!target.assetId || family.assets.some((asset) => asset.agentKey === target.agentKey))
      ),
    { path: ['assetId'] }
  );
const resultSchema = z.strictObject({
  agentKey: identifierSchema,
  documentId: z.string().regex(MKTG_DOCUMENT_ID_REGEX),
  revisionId: z.string().regex(MKTG_REVISION_ID_REGEX),
});

/** Server-only validation; schemas never enter browser barrels. */
export const mktgCreateRequestSchema = z
  .strictObject({
    project: projectSchema,
    kind: z.enum(MKTG_REQUEST_KINDS),
    target: createTargetSchema,
    text: textSchema,
    clientRequestId: tokenSchema,
  })
  .refine((body) => body.kind !== 'change' || !!body.target.documentId, { path: ['target', 'documentId'] });
const updateStateSchema = z
  .strictObject({
    project: projectSchema,
    state: z.enum(MKTG_REQUEST_STATES),
    note: textSchema.optional(),
    result: resultSchema.optional(),
    clientRequestId: tokenSchema,
  })
  .refine((body) => body.state !== 'declined' || !!body.note, { path: ['note'] })
  .refine((body) => !body.result || body.state === 'done', { path: ['result'] });
const withdrawSchema = z.strictObject({
  project: projectSchema,
  clientRequestId: tokenSchema,
  withdraw: z.literal(true),
  state: z.literal('declined').optional(),
});
export const mktgRequestStateSchema = z.union([updateStateSchema, withdrawSchema]);
const changeSchema = z
  .strictObject({
    clientRequestId: tokenSchema,
    state: z.enum(MKTG_REQUEST_STATES),
    note: z.string().max(MKTG_REQUEST_TEXT_MAX).nullable(),
    result: resultSchema.optional(),
    withdraw: z.boolean(),
    changedBy: z.string().min(1).nullable(),
  })
  .refine((change) => !change.result || change.state === 'done')
  .refine((change) => !change.withdraw || (change.state === 'declined' && change.note === MKTG_REQUEST_WITHDRAWN_NOTE));
const requestSchema = z
  .strictObject({
    id: tokenSchema,
    clientRequestId: tokenSchema,
    kind: z.enum(MKTG_REQUEST_KINDS),
    target: storedTargetSchema,
    text: textSchema,
    requestedBy: z.string().min(1).nullable(),
    requesterCommittees: z.array(z.string()),
    createdAt: z.iso.datetime(),
    state: z.enum(MKTG_REQUEST_STATES),
    stateChangedAt: z.iso.datetime(),
    stateChangedBy: z.string().min(1).nullable(),
    note: z.string().max(MKTG_REQUEST_TEXT_MAX).nullable(),
    result: resultSchema.optional(),
    stateChanges: z.array(changeSchema).max(MKTG_REQUEST_MAX_STATE_CHANGES),
  })
  .refine((row) => (row.kind !== 'change' || !!row.target.documentId) && (row.state !== 'declined' || !!row.note))
  .refine(
    (row) =>
      !row.result ||
      (row.state === 'done' && (row.kind !== 'change' || (row.result.agentKey === row.target.agentKey && row.result.documentId === row.target.documentId)))
  );
export const mktgRequestsRecordSchema = z
  .strictObject({
    schema: z.literal(MKTG_REQUESTS_SCHEMA),
    project: projectSchema,
    requests: z.array(requestSchema).max(MKTG_REQUESTS_MAX),
  })
  .refine(
    (record) =>
      new Set(record.requests.map((row) => row.id)).size === record.requests.length &&
      new Set(record.requests.map((row) => row.clientRequestId)).size === record.requests.length
  );
