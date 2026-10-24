// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const MKTG_REQUESTS_SCHEMA = 'mktg-requests/v1';
export const MKTG_REQUESTS_MAX = 500;
export const MKTG_REQUESTS_STORE_MAX_BYTES = 16_000_000;
export const MKTG_REQUEST_MAX_STATE_CHANGES = 2;
export const MKTG_REQUEST_TEXT_MAX = 2000;
export const MKTG_REQUEST_TARGET_ID_MAX = 200;
export const MKTG_REQUEST_WITHDRAWN_NOTE = 'withdrawn';
export const MKTG_REQUEST_KINDS = ['asset', 'change'] as const;
export const MKTG_REQUEST_STATES = ['open', 'in-progress', 'done', 'declined'] as const;
export const MKTG_REQUEST_OPEN_STATES = ['open', 'in-progress'] as const;
export const MKTG_REQUEST_STATE_LABELS = { open: 'Open', 'in-progress': 'In progress', done: 'Done', declined: 'Declined' } as const;
export const MKTG_REQUEST_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
