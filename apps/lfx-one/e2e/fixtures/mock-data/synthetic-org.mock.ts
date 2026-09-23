// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The invented organization Org Lens e2e fixtures stand on. Every value is fictional: the account id
 * has the shape the app validates (`001` + 15 alphanumerics) but belongs to no account, and the domain
 * uses the reserved `.example` TLD. Import these instead of typing an organization into a spec, so no
 * real customer's id, name or domain can drift into the suite.
 */
export const SYNTHETIC_ORG_ACCOUNT_ID = '0014100000AcmeAAAA';
export const SYNTHETIC_ORG_NAME = 'Acme Motors';
export const SYNTHETIC_ORG_LEGAL_NAME = 'Acme Motors, Inc.';
export const SYNTHETIC_ORG_SLUG = 'acme-motors';
export const SYNTHETIC_ORG_DOMAIN = 'acme-motors.example';
