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
} from '../constants/mktg-requests.constants';

const projectSchema = z.string().regex(MKTG_ARTIFACT_PARTITION_REGEX);
const tokenSchema = z.string().regex(MKTG_REQUEST_ID_REGEX);
const textSchema = z
  .string()
  .max(MKTG_REQUEST_TEXT_MAX)
  .refine((text) => !!text.trim());
const targetSchema = z
  .strictObject({
    familyId: z.string(),
    assetId: z.string().min(1).optional(),
    agentKey: z
      .string()
      .refine((key) => MKTG_DOCUMENT_TYPES.some((type) => type.agentKey === key))
      .optional(),
    documentId: z.string().regex(MKTG_DOCUMENT_ID_REGEX).optional(),
    revisionId: z.string().regex(MKTG_REVISION_ID_REGEX).optional(),
  })
  .refine((target) => (!target.documentId || !!target.agentKey) && (!target.revisionId || !!target.documentId), { path: ['documentId'] })
  .refine(
    (target) =>
      MKTG_KIT_FAMILIES.some(
        (family) =>
          family.id === target.familyId &&
          (!target.assetId || family.assets.some((asset) => asset.id === target.assetId && (!target.agentKey || asset.agentKey === target.agentKey)))
      ),
    { path: ['assetId'] }
  );

/** Server-only validation; schemas never enter browser barrels. */
export const mktgCreateRequestSchema = z
  .strictObject({
    project: projectSchema,
    kind: z.enum(MKTG_REQUEST_KINDS),
    target: targetSchema,
    text: textSchema,
    clientRequestId: tokenSchema,
  })
  .refine((body) => body.kind !== 'change' || !!body.target.documentId, { path: ['target', 'documentId'] });
export const mktgRequestStateSchema = z
  .strictObject({
    project: projectSchema,
    state: z.enum(MKTG_REQUEST_STATES),
    note: textSchema.optional(),
    resultRevisionId: z.string().regex(MKTG_REVISION_ID_REGEX).optional(),
    clientRequestId: tokenSchema,
  })
  .refine((body) => body.state !== 'declined' || !!body.note, { path: ['note'] });
const changeSchema = z.strictObject({
  clientRequestId: tokenSchema,
  state: z.enum(MKTG_REQUEST_STATES),
  note: z.string().max(MKTG_REQUEST_TEXT_MAX).nullable(),
  resultRevisionId: z.string().regex(MKTG_REVISION_ID_REGEX).nullable(),
  changedBy: z.string().min(1).nullable(),
});
const requestSchema = z
  .strictObject({
    id: tokenSchema,
    clientRequestId: tokenSchema,
    kind: z.enum(MKTG_REQUEST_KINDS),
    target: targetSchema,
    text: textSchema,
    requestedBy: z.string().min(1).nullable(),
    requesterCommittees: z.array(z.string()),
    createdAt: z.iso.datetime(),
    state: z.enum(MKTG_REQUEST_STATES),
    stateChangedAt: z.iso.datetime(),
    stateChangedBy: z.string().min(1).nullable(),
    note: z.string().max(MKTG_REQUEST_TEXT_MAX).nullable(),
    resultRevisionId: z.string().regex(MKTG_REVISION_ID_REGEX).nullable(),
    stateChanges: z.array(changeSchema).max(MKTG_REQUEST_MAX_STATE_CHANGES),
  })
  .refine((row) => (row.kind !== 'change' || !!row.target.documentId) && (row.state !== 'declined' || !!row.note));
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
