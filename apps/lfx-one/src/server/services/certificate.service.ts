// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import PDFDocument from 'pdfkit';
import fs, { existsSync } from 'fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { PDFTemplateDetails, CertificateData, CertificateEventRow } from '@lfx-one/shared/interfaces';
import { DEFAULT_TEMPLATE, PROJECT_TEMPLATES } from '@lfx-one/shared/constants/pdf.constants';

// In production, import.meta.url points to the server bundle (dist/lfx-one/server/server.mjs)
// and pdf-templates are copied there by the build script.
// In dev (ng serve), import.meta.url resolves to Vite's virtual root, so we fall back
// to the source tree via process.cwd() (which is apps/lfx-one/ when running ng serve).
function resolveTemplateDir(): string {
  const bundlePath = join(dirname(fileURLToPath(import.meta.url)), 'pdf-templates', 'visa-letter-manual');
  if (existsSync(bundlePath)) return bundlePath;

  const devPath = join(process.cwd(), 'src', 'server', 'pdf-templates', 'visa-letter-manual');
  if (existsSync(devPath)) return devPath;

  return bundlePath; // will produce a clear ENOENT if neither exists
}

const TEMPLATE_DIR = resolveTemplateDir();

export class CertificateService {
  private snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  public async generateCertificate(req: Request, data: CertificateData): Promise<Buffer> {
    logger.debug(req, 'generate_certificate', 'Fetching event data for certificate', {
      event_id: data.eventId,
    });

    const eventRow = await this.getEventRow(req, data.eventId, data.userEmail);
    const template = PROJECT_TEMPLATES[eventRow.PROJECT_ID] ?? DEFAULT_TEMPLATE;

    logger.debug(req, 'generate_certificate', 'Building PDF', {
      event_id: data.eventId,
      project_id: eventRow.PROJECT_ID,
    });

    return this.buildPdf(data.userName, eventRow, template);
  }

  private async getEventRow(req: Request, eventId: string, userEmail: string): Promise<CertificateEventRow> {
    const sql = `
      SELECT
        EVENT_NAME,
        EVENT_START_DATE,
        EVENT_END_DATE,
        EVENT_LOCATION,
        EVENT_CITY,
        EVENT_COUNTRY,
        PROJECT_ID
      FROM ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
      WHERE EVENT_ID = ?
        AND USER_EMAIL = ?
      LIMIT 1
    `;

    const result = await this.snowflakeService.execute<CertificateEventRow>(sql, [eventId, userEmail]);

    if (!result.rows.length) {
      throw new ResourceNotFoundError('EventRegistration', eventId, {
        operation: 'generate_certificate',
        service: 'certificate_service',
      });
    }

    return result.rows[0];
  }

  private buildPdf(userName: string, event: CertificateEventRow, template: PDFTemplateDetails): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const PAGE_START = 44;
      const doc = new PDFDocument({ size: 'LETTER' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const font = fs.readFileSync(join(TEMPLATE_DIR, 'fonts', 'Helvetica.ttc'));
      doc.registerFont('Helvetica', font);
      doc.font('Helvetica');

      // Project logo (top-left)
      doc.image(join(TEMPLATE_DIR, 'images', template.logo), PAGE_START, 47, { width: 145 });

      // Address & link (top-right)
      doc
        .fontSize(9)
        .fillColor('#5bb6e7')
        .text(template.address, 408, 40, { width: 200 })
        .fillColor('blue')
        .text(template.link, { link: template.link, underline: true });

      // Issue date
      doc
        .fontSize(11)
        .lineGap(1)
        .fillColor('black')
        .text(new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }), PAGE_START, 200);

      // Greeting
      doc.moveDown();
      doc.text(`Dear ${userName},`);
      doc.moveDown(2);

      // Event attendance body
      const location = this.formatLocation(event.EVENT_CITY, event.EVENT_COUNTRY, event.EVENT_LOCATION);
      doc.text(
        `${template.name} is pleased that you were able to attend ${event.EVENT_NAME}, which took place ${this.formatDateRange(event.EVENT_START_DATE, event.EVENT_END_DATE)} at ${location}.`,
        { width: 550 }
      );
      doc.moveDown();

      // Project description
      doc.text(template.desc, { width: 550 });
      doc.moveDown();

      // On behalf
      doc.text(template.onBehalf, { width: 550 });
      doc.moveDown(3);

      // Closing & signature
      doc.text('Yours truly,');
      doc.moveDown();
      doc.image(join(TEMPLATE_DIR, 'images', template.signature), { width: 110 });
      doc.moveDown();
      doc.text(template.signatureText);

      doc.end();
    });
  }

  private formatDateRange(start: Date | string, end: Date | string | null): string {
    const startDate = new Date(start);
    if (!end) return this.toFullDate(startDate);

    const endDate = new Date(end);
    if (startDate.toDateString() === endDate.toDateString()) return this.toFullDate(startDate);

    const sameYear = startDate.getFullYear() === endDate.getFullYear();
    const sameMonthYear = sameYear && startDate.getMonth() === endDate.getMonth();

    if (sameMonthYear) {
      return `${startDate.getDate()} - ${this.toFullDate(endDate)}`;
    }

    if (sameYear) {
      const startStr = startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      return `${startStr} - ${this.toFullDate(endDate)}`;
    }

    return `${this.toFullDate(startDate)} - ${this.toFullDate(endDate)}`;
  }

  private toFullDate(date: Date): string {
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  private formatLocation(city: string | null, country: string | null, location: string | null): string {
    if (city && country) return `${city}, ${country}`;
    if (city) return city;
    if (country) return country;
    return location ?? 'Virtual';
  }
}
