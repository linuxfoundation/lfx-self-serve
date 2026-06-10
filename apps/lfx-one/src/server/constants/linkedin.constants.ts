// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LinkedInTargetingProfileConfig } from '@lfx-one/shared/interfaces';

// ---------------------------------------------------------------------------
// LinkedIn Ads — Server-Only Constants
// ---------------------------------------------------------------------------
// These constants contain internal ad-account IDs, org IDs, employer-exclusion
// URNs, and targeting URN lists that must NOT ship to the client bundle.
// UI-safe constants (geo resolve map, char limits) remain in @lfx-one/shared.
// ---------------------------------------------------------------------------

export const LINKEDIN_DEFAULT_ACCOUNT_ID = '509430019';

export const LINKEDIN_ACCOUNTS: readonly { accountId: string; label: string; orgId: string }[] = [
  { accountId: '538170226', label: 'The Linux Foundation', orgId: '208777' },
  { accountId: '509430019', label: 'LF Events', orgId: '208777' },
  { accountId: '500928401', label: 'Cloud Native Computing Foundation', orgId: '12893459' },
  { accountId: '508209098', label: 'Linux Foundation - Education', orgId: '7953130' },
  { accountId: '537341179', label: 'Agentic AI Foundation', orgId: '111268938' },
  { accountId: '514914665', label: 'OpenSearch Project (2nd Account)', orgId: '78470501' },
  { accountId: '515250253', label: 'LF OpenJS Ad Account', orgId: '19082105' },
  { accountId: '531310265', label: 'LF Agentic AI Ad Account', orgId: '111268938' },
  { accountId: '515244770', label: 'OpenJS Foundation', orgId: '19082105' },
  { accountId: '514596831', label: 'OpenSSF', orgId: '76521837' },
  { accountId: '514553720', label: 'OpenSearch Project', orgId: '78470501' },
] as const;

export const LINKEDIN_DEFAULT_ORG_ID = LINKEDIN_ACCOUNTS.find((a) => a.accountId === LINKEDIN_DEFAULT_ACCOUNT_ID)!.orgId;

export const LINKEDIN_EMPLOYER_EXCLUSIONS: readonly string[] = ['urn:li:company:33275771', 'urn:li:company:12893459'] as const;

export const LINKEDIN_TARGETING_PROFILES: readonly LinkedInTargetingProfileConfig[] = [
  {
    id: 'cloud-native',
    label: 'Cloud Native / CNCF',
    skills: [
      'urn:li:skill:55158',
      'urn:li:skill:56347',
      'urn:li:skill:56319',
      'urn:li:skill:18442',
      'urn:li:skill:1500290',
      'urn:li:skill:55734',
      'urn:li:skill:55383',
      'urn:li:skill:1500358',
      'urn:li:skill:56908',
      'urn:li:skill:58498',
      'urn:li:skill:55644',
      'urn:li:skill:55102',
      'urn:li:skill:56912',
      'urn:li:skill:18443',
      'urn:li:skill:25168',
      'urn:li:skill:56320',
      'urn:li:skill:25154',
      'urn:li:skill:56580',
      'urn:li:skill:56581',
      'urn:li:skill:55385',
    ],
    groups: [
      'urn:li:group:6821178',
      'urn:li:group:9375272',
      'urn:li:group:12405624',
      'urn:li:group:12391549',
      'urn:li:group:8553150',
      'urn:li:group:13681295',
      'urn:li:group:4490628',
      'urn:li:group:2602008',
      'urn:li:group:50985',
      'urn:li:group:6585490',
      'urn:li:group:3779791',
      'urn:li:group:13799412',
    ],
  },
  {
    id: 'mcp',
    label: 'MCP / Agentic AI',
    skills: [
      'urn:li:skill:59695',
      'urn:li:skill:59040',
      'urn:li:skill:61790',
      'urn:li:skill:2407',
      'urn:li:skill:3289',
      'urn:li:skill:56912',
      'urn:li:skill:61642',
      'urn:li:skill:59698',
      'urn:li:skill:5835',
    ],
    groups: ['urn:li:group:6672014', 'urn:li:group:6608681', 'urn:li:group:6773450', 'urn:li:group:10321152', 'urn:li:group:6731624', 'urn:li:group:961087'],
  },
] as const;
