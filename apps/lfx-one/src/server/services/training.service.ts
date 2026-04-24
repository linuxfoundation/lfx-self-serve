// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import {
  CertificateRow,
  Certification,
  CertificationStatus,
  EnrollmentRow,
  TrainingEnrollment,
  UnifiedCertification,
  UnifiedCertRow,
  UnifiedCertState,
} from '@lfx-one/shared/interfaces';
import { CERTIFICATION_PRODUCT_TYPE, TRAINING_PRODUCT_TYPE } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { tiService } from './ti.service';

const CERTIFICATES_BASE_QUERY = `
  SELECT _KEY, IDENTIFIER, COURSE_NAME, COURSE_GROUP_DESCRIPTION,
         LOGO_URL, PROJECT_NAME, ISSUED_TS, EXPIRATION_DATE, DOWNLOAD_URL, LEVEL, COURSE_ID
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
  SELECT ENROLLMENT_ID, COURSE_NAME, COURSE_GROUP_DESCRIPTION,
         LOGO_URL, PROJECT_NAME, LEVEL, COURSE_SLUG, COURSE_ID,
         STATUS, IS_ACTIVE_ENROLLMENT, ENROLLMENT_TS, TOTAL_TIME
  FROM ANALYTICS.PLATINUM_LFX_ONE.USER_COURSE_ENROLLMENTS
  WHERE USER_NAME = ? AND PRODUCT_TYPE = ?
  ORDER BY
    CASE STATUS
      WHEN 'started' THEN 1
      WHEN 'not-started' THEN 2
      WHEN 'not-completed' THEN 3
      WHEN 'completed' THEN 4
      ELSE 5
    END,
    COURSE_NAME ASC
`;

const UNIFIED_CERTIFICATIONS_QUERY = `
  WITH best_enrollment AS (
    SELECT
      COURSE_ID, COURSE_NAME, COURSE_GROUP_DESCRIPTION, LOGO_URL, PROJECT_NAME, LEVEL,
      ENROLLMENT_ID, STATUS, IS_ACTIVE_ENROLLMENT, COURSE_SLUG,
      ROW_NUMBER() OVER (
        PARTITION BY COURSE_ID
        ORDER BY IS_ACTIVE_ENROLLMENT DESC NULLS LAST, ENROLLMENT_TS DESC NULLS LAST, ENROLLMENT_ID DESC
      ) AS rn
    FROM ANALYTICS.PLATINUM_LFX_ONE.USER_COURSE_ENROLLMENTS
    WHERE USER_NAME = ? AND PRODUCT_TYPE = ?
  ),
  best_cert AS (
    SELECT
      COURSE_ID, COURSE_NAME, COURSE_GROUP_DESCRIPTION, LOGO_URL, PROJECT_NAME, LEVEL,
      _KEY, IDENTIFIER, ISSUED_TS, EXPIRATION_DATE, DOWNLOAD_URL,
      ROW_NUMBER() OVER (
        PARTITION BY COURSE_ID
        ORDER BY EXPIRATION_DATE DESC NULLS FIRST, ISSUED_TS DESC NULLS LAST, _KEY DESC
      ) AS rn
    FROM ANALYTICS.PLATINUM_LFX_ONE.USER_CERTIFICATES
    WHERE USER_NAME = ?
      AND PRODUCT_TYPE = ?
  ),
  e AS (SELECT * FROM best_enrollment WHERE rn = 1),
  c AS (SELECT * FROM best_cert WHERE rn = 1)

  SELECT
    COALESCE(e.COURSE_ID, c.COURSE_ID)                    AS COURSE_ID,
    COALESCE(e.COURSE_NAME, c.COURSE_NAME)                AS COURSE_NAME,
    COALESCE(e.COURSE_GROUP_DESCRIPTION, c.COURSE_GROUP_DESCRIPTION) AS COURSE_GROUP_DESCRIPTION,
    COALESCE(e.LOGO_URL, c.LOGO_URL)                      AS LOGO_URL,
    COALESCE(e.PROJECT_NAME, c.PROJECT_NAME)              AS PROJECT_NAME,
    COALESCE(e.LEVEL, c.LEVEL)                            AS LEVEL,
    e.ENROLLMENT_ID,
    e.STATUS                                              AS ENROLLMENT_STATUS,
    e.IS_ACTIVE_ENROLLMENT,
    e.COURSE_SLUG,
    c._KEY                                                AS CERT_KEY,
    c.IDENTIFIER                                          AS CERT_IDENTIFIER,
    c.ISSUED_TS,
    c.EXPIRATION_DATE,
    c.DOWNLOAD_URL
  FROM e
  FULL OUTER JOIN c ON e.COURSE_ID = c.COURSE_ID
  WHERE COALESCE(e.COURSE_ID, c.COURSE_ID) IS NOT NULL
`;

const UNIFIED_CERT_STATE_ORDER: Record<UnifiedCertState, number> = {
  'certified-active': 1,
  'cert-only': 1,
  'expiring-soon': 2,
  'enrolled-cert-expired': 3,
  'cert-expired': 4,
  'in-progress': 5,
};

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

    const certifications = result.rows.map((row) => this.mapRowToCertification(row));
    const courseIds = result.rows.map((row) => row.COURSE_ID);

    return this.enrichWithTiLogos(req, certifications, courseIds);
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

    const enrollments = result.rows.map((row) => this.mapRowToEnrollment(row));
    const courseIds = result.rows.map((row) => row.COURSE_ID);

    return this.enrichWithTiLogos(req, enrollments, courseIds);
  }

  public async getUnifiedCertifications(req: Request, username: string): Promise<UnifiedCertification[]> {
    logger.debug(req, 'get_unified_certifications', 'Fetching unified certifications from Snowflake', { username });

    let result: { rows: UnifiedCertRow[] };

    try {
      result = await this.snowflakeService.execute<UnifiedCertRow>(UNIFIED_CERTIFICATIONS_QUERY, [
        username,
        CERTIFICATION_PRODUCT_TYPE,
        username,
        CERTIFICATION_PRODUCT_TYPE,
      ]);
    } catch (error) {
      logger.warning(req, 'get_unified_certifications', 'Snowflake query failed, returning empty', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    logger.debug(req, 'get_unified_certifications', 'Fetched unified certifications', { count: result.rows.length });

    const items = result.rows.map((row) => this.mapRowToUnifiedCert(row));
    items.sort((a, b) => UNIFIED_CERT_STATE_ORDER[a.state] - UNIFIED_CERT_STATE_ORDER[b.state] || a.name.localeCompare(b.name));
    const courseIds = items.map((item) => item.courseId || null);

    return this.enrichWithTiLogos(req, items, courseIds);
  }

  // ─── Private Enrichment Methods ────────────────────────────────────────────

  /**
   * Enriches items with logo URLs fetched from the TI API.
   * Course IDs that are null or have no TI match are left with their existing imageUrl.
   */
  private async enrichWithTiLogos<T extends { imageUrl: string }>(req: Request, items: T[], courseIds: (string | null)[]): Promise<T[]> {
    const validIds = courseIds.filter((id): id is string => Boolean(id));
    if (validIds.length === 0) return items;

    const logoMap = await tiService.getLogoUrls(req, validIds);
    if (logoMap.size === 0) return items;

    logger.info(req, 'enrich_ti_logos', 'Enriched with TI logo URLs', { enriched: logoMap.size });

    return items.map((item, i) => {
      const courseId = courseIds[i];
      return courseId && logoMap.has(courseId) ? { ...item, imageUrl: logoMap.get(courseId)! } : item;
    });
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
      level: row.LEVEL ?? '',
      courseSlug: row.COURSE_SLUG ?? null,
      enrolledDate: row.ENROLLMENT_TS ?? null,
      totalTime: row.TOTAL_TIME ?? null,
      status: row.STATUS ?? null,
      isActiveEnrollment: row.IS_ACTIVE_ENROLLMENT,
    };
  }

  private mapRowToUnifiedCert(row: UnifiedCertRow): UnifiedCertification {
    return {
      courseId: row.COURSE_ID ?? '',
      name: row.COURSE_NAME,
      description: row.COURSE_GROUP_DESCRIPTION ?? '',
      imageUrl: row.LOGO_URL ?? '',
      issuedBy: row.PROJECT_NAME ?? '',
      level: row.LEVEL ?? '',
      state: this.deriveUnifiedCertState(row),
      enrollmentId: row.ENROLLMENT_ID ?? null,
      enrollmentStatus: row.ENROLLMENT_STATUS ?? null,
      isActiveEnrollment: row.IS_ACTIVE_ENROLLMENT ?? null,
      courseSlug: row.COURSE_SLUG ?? null,
      certId: row.CERT_KEY ?? null,
      certificateId: row.CERT_IDENTIFIER ?? null,
      issuedDate: row.ISSUED_TS ?? null,
      expiryDate: row.EXPIRATION_DATE ?? null,
      downloadUrl: row.DOWNLOAD_URL ?? null,
    };
  }

  private deriveUnifiedCertState(row: UnifiedCertRow): UnifiedCertState {
    const hasCert = row.CERT_KEY !== null;
    const hasActiveEnrollment = row.IS_ACTIVE_ENROLLMENT === true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayPlus90 = new Date(today);
    todayPlus90.setDate(todayPlus90.getDate() + 90);

    let expiryDateOnly: Date | null = null;
    if (row.EXPIRATION_DATE !== null) {
      expiryDateOnly = new Date(row.EXPIRATION_DATE);
      expiryDateOnly.setHours(0, 0, 0, 0);
    }

    const certExpired = hasCert && expiryDateOnly !== null && expiryDateOnly < today;
    const certExpiringSoon = hasCert && expiryDateOnly !== null && !certExpired && expiryDateOnly <= todayPlus90;

    if (hasCert && certExpired && hasActiveEnrollment) return 'enrolled-cert-expired';
    if (hasCert && certExpired) return 'cert-expired';
    if (hasCert && certExpiringSoon) return 'expiring-soon';
    if (hasCert && !row.ENROLLMENT_ID) return 'cert-only';
    if (hasCert) return 'certified-active';
    if (hasActiveEnrollment) return 'in-progress';
    return 'cert-expired'; // expired enrollment, no cert
  }

  private deriveStatus(expirationDate: string | null): CertificationStatus {
    if (!expirationDate) return 'active';
    return new Date(expirationDate) < new Date() ? 'expired' : 'active';
  }
}
