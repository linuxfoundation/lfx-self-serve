// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Dev-only fixture gate — enabled when MOCK_ORG_ITEMS is the literal `'true'` or `'1'` AND NODE_ENV !== 'production'. Fail-closed: other truthy-looking values are rejected. */
export const isMockOrgItemsEnabled = (): boolean => {
  if (process.env['NODE_ENV'] === 'production') return false;
  const value = process.env['MOCK_ORG_ITEMS'];
  return value === 'true' || value === '1';
};
