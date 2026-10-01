// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { SnowflakeService } from './snowflake.service';

import type { HealthMetricsTrainingPresence, HealthMetricsTrainingPresenceQuery } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const TRAINING_SUMMARY_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.TRAINING_SUMMARY';

interface PresenceRow {
  ROW_COUNT: number | null;
}

/** Snowflake reads behind the Health Metrics Training tab; every figure is foundation-wide. */
export class HealthMetricsTrainingService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Whether LF Education has any training rows for the foundation; none means it runs no programme. */
  public async getPresence(req: Request, query: HealthMetricsTrainingPresenceQuery): Promise<HealthMetricsTrainingPresence> {
    const sql = `
      SELECT COUNT(*) AS row_count
      FROM ${TRAINING_SUMMARY_VIEW}
      WHERE foundation_slug = ?
    `;

    const { rows } = await executeSnowflakeViewRead<PresenceRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      operation: 'get_training_presence',
      view: TRAINING_SUMMARY_VIEW,
      clientMessage: 'Training is unavailable right now.',
    });

    return { hasProgramme: Number(rows[0]?.ROW_COUNT ?? 0) > 0 };
  }
}
