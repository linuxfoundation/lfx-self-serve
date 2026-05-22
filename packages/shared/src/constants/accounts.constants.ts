// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Account } from '../interfaces/account.interface';

export const ACCOUNT_COOKIE_KEY = 'lfx-selected-account';

/**
 * Demo seed for the Org Lens feature branch. Used as a fallback in
 * PersonaDetectionService when the upstream persona service doesn't yet
 * return user-scoped { accountId, cdevOrgId } pairs (blocked on upstream
 * persona-service work). Only identifier + display name live here —
 * tier, slug, and logo are intentionally resolved from Snowflake via
 * getOrgLensAccountContext, so the demo exercises the real enrichment
 * path end-to-end.
 *
 * Remove (or replace with a live source) once the persona service
 * delivers organizations directly.
 */
export const ORG_LENS_DEMO_SEED_ACCOUNTS: Account[] = [
  { accountId: '0012M00002ND5yOQAT', accountName: 'Toyota Motor Corporation' },
  { accountId: '0014100000kgVoqAAE', accountName: 'International Business Machines Corporation' },
  { accountId: '0014100000Te2QjAAJ', accountName: 'Red Hat, Inc.' },
  { accountId: '0014100000TdzYmAAJ', accountName: 'Apptio' },
  { accountId: '0012M00002ZLGHsQAP', accountName: 'IBM Watson Health' },
  { accountId: '0012M000027Enn8QAC', accountName: 'Nordcloud, an IBM Company' },
  { accountId: '0012M00002F2mObQAJ', accountName: 'Stackwatch Inc' },
  { accountId: '0014100000Te2qeAAB', accountName: 'Turbonomic, an IBM Company' },
];
