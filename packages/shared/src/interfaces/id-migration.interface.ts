// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ID_MIGRATION_REASONS } from '../constants/id-migration.constants';

/** A reason value a user can pick in the Individual Dashboard return modal (LFXV2-3336). */
export type IdMigrationReason = (typeof ID_MIGRATION_REASONS)[number]['value'];
