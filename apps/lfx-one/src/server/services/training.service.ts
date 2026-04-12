// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { CertificateRow, Certification, CertificationStatus, EnrollmentRow, TrainingEnrollment } from '@lfx-one/shared/interfaces';
import { TRAINING_PRODUCT_TYPE } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

const CERTIFICATES_BASE_QUERY = `
  SELECT _KEY, IDENTIFIER, COURSE_NAME, COURSE_GROUP_DESCRIPTION,
         LOGO_URL, PROJECT_NAME, ISSUED_TS, EXPIRATION_DATE, DOWNLOAD_URL, LEVEL
  FROM ANALYTICS.PLATINUM_LFX_ONE.USER_CERTIFICATES
  WHERE USER_NAME = ?`;

const CERTIFICATES_FILTERED_QUERY = `${CERTIFICATES_BASE_QUERY}
  AND PRODUCT_TYPE = ?
  ORDER BY ISSUED_TS DESC
`;

const CERTIFICATES_UNFILTERED_QUERY = `${CERTIFICATES_BASE_QUERY}
  ORDER BY ISSUED_TS DESC
`;

const ENROLLMENTS_QUERY = `
  SELECT ENROLLMENT_ID, ENROLLMENT_TS, COURSE_NAME, COURSE_GROUP_DESCRIPTION,
         LOGO_URL, PROJECT_NAME, LEVEL, COURSE_SLUG
  FROM ANALYTICS.PLATINUM_LFX_ONE.USER_COURSE_ENROLLMENTS
  WHERE USER_NAME = ? AND PRODUCT_TYPE = ?
  ORDER BY ENROLLMENT_TS DESC
`;

export class TrainingService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  public async getCertifications(req: Request, username: string, productType?: string): Promise<Certification[]> {
    logger.debug(req, 'get_certifications', 'Fetching certifications from Snowflake', { username, productType });

    let result: { rows: CertificateRow[] };

    try {
      if (productType) {
        result = await this.snowflakeService.execute<CertificateRow>(CERTIFICATES_FILTERED_QUERY, [username, productType]);
      } else {
        result = await this.snowflakeService.execute<CertificateRow>(CERTIFICATES_UNFILTERED_QUERY, [username]);
      }
    } catch (error) {
      logger.warning(req, 'get_certifications', 'Snowflake query failed, returning empty certifications', {
        error: error instanceof Error ? error.message : String(error),
      });

      return [];
    }

    logger.debug(req, 'get_certifications', 'Fetched certifications', { count: result.rows.length });

    return result.rows.map((row) => this.mapRowToCertification(row));
  }

  public async getEnrollments(req: Request, username: string): Promise<TrainingEnrollment[]> {
    logger.debug(req, 'get_enrollments', 'Fetching enrollments from Snowflake', { username });

    let result: { rows: EnrollmentRow[] };

    try {
      result = await this.snowflakeService.execute<EnrollmentRow>(ENROLLMENTS_QUERY, [username, TRAINING_PRODUCT_TYPE]);
    } catch (error) {
      logger.warning(req, 'get_enrollments', 'Snowflake query failed, returning empty enrollments', {
        error: error instanceof Error ? error.message : String(error),
      });

      return [];
    }

    logger.debug(req, 'get_enrollments', 'Fetched enrollments', { count: result.rows.length });

    return result.rows.map((row) => this.mapRowToEnrollment(row));
  }

  private mapRowToCertification(row: CertificateRow): Certification {
    return {
      id: row._KEY,
      certificateId: row.IDENTIFIER,
      name: row.COURSE_NAME,
      description: row.COURSE_GROUP_DESCRIPTION ?? '',
      imageUrl: row.LOGO_URL ?? '',
      issuedBy: row.PROJECT_NAME ?? '',
      issuedDate: row.ISSUED_TS,
      expiryDate: row.EXPIRATION_DATE ?? null,
      status: this.deriveStatus(row.EXPIRATION_DATE),
      downloadUrl: row.DOWNLOAD_URL ?? null,
      level: row.LEVEL ?? '',
    };
  }

  private mapRowToEnrollment(row: EnrollmentRow): TrainingEnrollment {
    return {
      id: row.ENROLLMENT_ID,
      name: row.COURSE_NAME,
      description: row.COURSE_GROUP_DESCRIPTION ?? '',
      imageUrl: row.LOGO_URL ?? '',
      issuedBy: row.PROJECT_NAME ?? '',
      enrolledDate: row.ENROLLMENT_TS,
      level: row.LEVEL ?? '',
      courseSlug: row.COURSE_SLUG ?? null,
    };
  }

  private deriveStatus(expirationDate: string | null): CertificationStatus {
    if (!expirationDate) return 'active';
    return new Date(expirationDate) < new Date() ? 'expired' : 'active';
  }
}
