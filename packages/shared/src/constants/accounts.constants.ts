// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Account } from '../interfaces/account.interface';

/**
 * Available accounts for board member dashboard
 * @description Predefined list of organizations with their account IDs
 */
export const ACCOUNTS: Account[] = [
  { accountId: '0014100000Te04HAAR', accountName: 'Hitachi, Ltd.' },
  { accountId: '0014100000Te2QjAAJ', accountName: 'Red Hat, Inc.' },
  { accountId: '0014100000TdzJHAAZ', accountName: 'Fujitsu Limited' },
  { accountId: '0014100000Te0dPAAR', accountName: 'Samsung Electronics Co. Ltd.' },
  { accountId: '0014100000TdzwSAAR', accountName: 'Meta Platforms, Inc.' },
  { accountId: '0014100000Te0OKAAZ', accountName: 'Microsoft Corporation' },
  { accountId: '0014100000Te2PpAAJ', accountName: 'Qualcomm, Inc.' },
  { accountId: '0014100000TdzA7AAJ', accountName: 'Intel Corporation' },
  { accountId: '0014100000TdzABAAZ', accountName: 'Huawei Technologies Co., Ltd' },
  { accountId: '0014100000Te0QfAAJ', accountName: 'NEC Corporation' },
  { accountId: '0014100000Te08IAAR', accountName: 'Ericsson' },
  { accountId: '0014100000Te2MfAAJ', accountName: 'Oracle America Inc.' },
  { accountId: '0014100000Te2ovAAB', accountName: 'The Linux Foundation' },
];

/**
 * Default account for board member dashboard
 * @description Microsoft Corporation is used as the default selection
 */
export const DEFAULT_ACCOUNT: Account = {
  accountId: '0014100000Te0OKAAZ',
  accountName: 'Microsoft Corporation',
};
