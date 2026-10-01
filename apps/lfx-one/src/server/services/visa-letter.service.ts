// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import PDFDocument from 'pdfkit';
import fs from 'fs';
import { join } from 'node:path';
import { Request } from 'express';

import { VISA_LETTER_MANUAL_ERROR_CODE, VISA_LETTER_NOT_ISSUED_ERROR_CODE } from '@lfx-one/shared/constants';
import {
  VISA_LETTER_COUNTRY_ENTITIES,
  VISA_LETTER_DEFAULT_ENTITY,
  VISA_LETTER_FIXED_PAYERS,
  VISA_LETTER_ISSUED_STATUS,
  VISA_LETTER_LF_EUROPE_COUNTRIES,
  VISA_LETTER_MEMBERS_LINK,
  VISA_LETTER_SIGNATORY,
} from '@lfx-one/shared/constants/pdf.constants';
import { VisaLetterEntity, VisaLetterRequest, VisaLetterRequestsResponse, VisaLetterResult } from '@lfx-one/shared/interfaces';
import { buildVisaLetterFileName } from '@lfx-one/shared/utils';

import { AuthorizationError, MicroserviceError, ResourceNotFoundError } from '../errors';
import { getUserServiceBaseUrl } from '../helpers/api-gateway.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { resolvePdfTemplateDir } from '../helpers/pdf-template.helper';
import { logger } from './logger.service';
import { UserService } from './user.service';

const TEMPLATE_DIR = resolvePdfTemplateDir();
const OPERATION = 'generate_visa_letter';
const SERVICE = 'visa_letter_service';

export class VisaLetterService {
  private userService: UserService;

  public constructor() {
    this.userService = new UserService();
  }

  /**
   * Generate the caller's issued visa support letter for an event. Status, ownership and the manual
   * flag come from the letter system of record, never from the client.
   */
  public async generateVisaLetter(req: Request, eventId: string): Promise<VisaLetterResult> {
    const letter = await this.getLetterRequest(req, eventId);

    if (letter.hsTicketStatus !== VISA_LETTER_ISSUED_STATUS) {
      throw new AuthorizationError('Visa letter has not been issued yet', {
        operation: OPERATION,
        service: SERVICE,
        code: VISA_LETTER_NOT_ISSUED_ERROR_CODE,
      });
    }

    if (letter.isManualVisaLetter) {
      throw new AuthorizationError('The events team will email you this visa letter', {
        operation: OPERATION,
        service: SERVICE,
        code: VISA_LETTER_MANUAL_ERROR_CODE,
      });
    }

    const entity = this.resolveEntity(letter.event?.country);

    logger.debug(req, OPERATION, 'Building visa letter PDF', { event_id: eventId, entity: entity.name });

    const pdf = await this.buildPdf(letter, entity);
    const fileName = buildVisaLetterFileName(letter.event?.name, letter.attendee?.nameAsPerPassport, eventId);
    return { pdf, fileName };
  }

  /** The caller's own letter request for the event; the Salesforce ID is derived from their token. */
  private async getLetterRequest(req: Request, eventId: string): Promise<VisaLetterRequest> {
    const profile = await this.userService.getApiGatewayProfile(req);

    if (!profile.ID) {
      throw new MicroserviceError('Salesforce ID not found in API Gateway profile', 422, 'SALESFORCE_ID_NOT_FOUND', {
        operation: OPERATION,
        service: SERVICE,
      });
    }

    // Mirrors submitVisaRequestApplication, which files dev requests under the override event id.
    const upstreamEventId =
      process.env['NODE_ENV'] !== 'production' && process.env['API_GW_DEV_EVENT_ID_OVERRIDE'] ? process.env['API_GW_DEV_EVENT_ID_OVERRIDE'] : eventId;

    const url = `${getUserServiceBaseUrl(OPERATION, SERVICE)}/users/${encodeURIComponent(profile.ID)}/visaletterrequests`;
    const response = await gatewayFetch<VisaLetterRequestsResponse>(req, url, {
      operation: OPERATION,
      service: SERVICE,
      errorMessage: 'Failed to fetch visa letter requests',
      errorCode: 'VISA_LETTER_REQUESTS_FETCH_FAILED',
      // Letter requests carry passport and birth details; keep them out of logs and error metadata.
      redactResponseBody: true,
    });

    const matches = (response?.Data ?? []).filter((request) => request.event?.id === upstreamEventId);
    // A user can re-apply after a denial, so prefer the issued request over older ones.
    const letter = matches.find((request) => request.hsTicketStatus === VISA_LETTER_ISSUED_STATUS) ?? matches[0];

    if (!letter) {
      throw new ResourceNotFoundError('VisaLetterRequest', eventId, { operation: OPERATION, service: SERVICE });
    }

    return letter;
  }

  private resolveEntity(country: string | undefined): VisaLetterEntity {
    if (!country) return VISA_LETTER_DEFAULT_ENTITY;
    if (VISA_LETTER_LF_EUROPE_COUNTRIES.has(country)) return VISA_LETTER_COUNTRY_ENTITIES.europe;
    if (country === 'India') return VISA_LETTER_COUNTRY_ENTITIES.india;
    if (country === 'China') return VISA_LETTER_COUNTRY_ENTITIES.china;
    return VISA_LETTER_DEFAULT_ENTITY;
  }

  private resolvePaidBy(letter: VisaLetterRequest): string {
    const paidBy = letter.attendeeAccommodationPaidBy;
    if (paidBy === 'delegate') return letter.attendee?.nameAsPerPassport ?? '';
    if (paidBy === 'delegates_company') return letter.attendee?.Account?.Name ?? '';
    return (paidBy && VISA_LETTER_FIXED_PAYERS[paidBy]) ?? '';
  }

  // Dates are calendar dates upstream, so format in UTC to avoid shifting a day across timezones.
  private formatDate(value: string | undefined, entity: VisaLetterEntity): string {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return entity.dayFirstDates
      ? date.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' })
      : date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: '2-digit', year: 'numeric' });
  }

  private formatEventLocation(letter: VisaLetterRequest): string {
    const { location, city, state, country } = letter.event ?? {};
    return [location, city, state, country].filter((part) => !!part).join(', ');
  }

  private formatAttendeeAddress(letter: VisaLetterRequest): string {
    const { Street, City, State, PostalCode, Country } = letter.attendee?.Address ?? {};
    const cityState = [City, State].filter((part) => !!part).join(', ');
    return [Street, cityState, PostalCode, Country].filter((part) => !!part).join('\n');
  }

  private buildPdf(letter: VisaLetterRequest, entity: VisaLetterEntity): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const PAGE_START = 44;
      const TAB_INDENT = 150;
      const doc = new PDFDocument({ size: 'LETTER' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const event = letter.event ?? {};
      const attendee = letter.attendee ?? {};
      const nameOnPassport = attendee.nameAsPerPassport ?? '';
      const country = event.country ?? '';

      doc.registerFont('Helvetica', fs.readFileSync(join(TEMPLATE_DIR, 'fonts', 'Helvetica.ttc')));
      doc.font('Helvetica');

      // Letterhead: logo (top-left), address and link (top-right)
      doc.image(join(TEMPLATE_DIR, 'images', entity.logo), PAGE_START, 47, { width: entity.logoWidth });
      doc
        .fontSize(9)
        .fillColor('#5bb6e7')
        .text(entity.address, 408, 40, { width: 200 })
        .fillColor('blue')
        .text(entity.link, { link: entity.link, underline: true });

      doc.fontSize(11).lineGap(1).fillColor('black').text(this.formatDate(letter.visaLetterIssuedDate, entity), PAGE_START, 114);
      doc.text(`Dear Embassy${country ? ` of ${country}` : ''}:`);
      doc.moveDown();
      doc.text(
        `${entity.name} is pleased to invite the following delegate ${letter.attendeeType === 'speaker' ? 'to speak at' : 'to attend'} ${event.name ?? ''}.`,
        { width: 550 }
      );
      doc.moveDown();

      // PDFKit skips empty text without advancing, so moveUp would overlap the next row.
      const field = (label: string, value: string): void => {
        doc
          .text(label, PAGE_START)
          .moveUp()
          .text(value || ' ', TAB_INDENT);
      };

      field('Event Name:', event.name ?? '');
      doc.moveDown();
      field('Event Date:', `${this.formatDate(event.startDate, entity)} - ${this.formatDate(event.endDate, entity)}`);
      field('Event Location:', this.formatEventLocation(letter));
      doc.moveDown();
      field('Name:', nameOnPassport);
      field('Passport number:', attendee.passportNumber ?? '');
      field('Date of Birth:', this.formatDate(attendee.birthDate, entity));
      field('Country of Birth:', attendee.birthCountry ?? '');
      field('Company:', attendee.Account?.Name ?? '');
      field('Title:', attendee.jobTitle ?? '');
      field('Phone Number:', attendee.contactNumber ?? '');
      field('Address:', this.formatAttendeeAddress(letter));
      doc.moveDown();

      doc
        .text(`${entity.name} (`, PAGE_START, undefined, { width: 527, continued: true })
        .fillColor('blue')
        .text(entity.link, { link: entity.link, underline: true, continued: true })
        .fillColor('black')
        .text(
          `) is a nonprofit consortium dedicated to fostering the growth of the Linux operating system. ${entity.name} promotes, protects and standardizes Linux by providing unified resources and services. It is supported by its members - the leading IT companies such as IBM, Intel, Hewlett Packard, etc.`,
          { continued: true, underline: false, link: null }
        )
        .fillColor('blue');

      if (entity.showMembersLink) {
        doc
          .text(' ', { continued: true })
          .text(VISA_LETTER_MEMBERS_LINK, { continued: true, underline: true, link: VISA_LETTER_MEMBERS_LINK })
          .text('.', { link: null, underline: false });
      } else {
        doc.text(' ', { link: null });
      }

      doc.moveDown();
      doc.fillColor('black').text(`All cost of travel and accommodation will be paid for by ${this.resolvePaidBy(letter)}`);
      doc.moveDown();
      doc.text(
        `On behalf of ${entity.name}, we would be extremely grateful if you could assist in granting ${nameOnPassport} a VISA as we look forward to seeing ${nameOnPassport} in ${country}.`
      );
      doc.moveDown(3);

      doc.text('Yours truly,');
      // TODO(#3191): signatory text overlaps the image; fix together with the certificate.
      doc.image(join(TEMPLATE_DIR, 'images', 'image1.png'), PAGE_START, undefined, { width: 110 });
      const signatureOrg = entity.signatureOrgFromEvent && event.name ? event.name : entity.signatureOrg;
      const { name, title, phone } = VISA_LETTER_SIGNATORY;
      doc.text(`${name}\n${title}\n${signatureOrg}\n${phone}`);

      doc.end();
    });
  }
}
