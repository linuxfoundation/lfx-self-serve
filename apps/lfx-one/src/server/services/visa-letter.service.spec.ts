// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The `utils` barrel pulls in Angular-dependent modules this `node` spec can't load, so it is
// narrowed to the one pure function the service needs (same approach as certificate.service.spec.ts).
const mocks = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  getApiGatewayProfile: vi.fn(),
  images: [] as { path: string; y: number; options: Record<string, unknown> | undefined }[],
  texts: [] as string[],
  textYs: [] as number[],
}));

vi.mock('@lfx-one/shared/utils', async () => {
  const eventUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/event.utils')>(
    '../../../../../packages/shared/src/utils/event.utils'
  );
  return { buildVisaLetterFileName: eventUtils.buildVisaLetterFileName };
});
vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch: mocks.gatewayFetch }));
vi.mock('../helpers/api-gateway.helper', () => ({ getUserServiceBaseUrl: vi.fn(() => 'https://gw.test/user-service/v1') }));
vi.mock('./user.service', () => ({
  UserService: class {
    public getApiGatewayProfile = mocks.getApiGatewayProfile;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// PDFKit is stubbed so assertions read the draw calls instead of parsing a rendered binary.
vi.mock('pdfkit', () => {
  class FakePDFDocument {
    public y = 0;
    private handlers: Record<string, ((arg?: unknown) => void)[]> = {};

    public on(event: string, handler: (arg?: unknown) => void): this {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }

    public image(path: string, ...rest: unknown[]): this {
      const options = rest.find((arg) => typeof arg === 'object' && arg !== null) as Record<string, unknown> | undefined;
      mocks.images.push({ path, y: this.y, options });
      return this;
    }

    public text(text: unknown): this {
      if (typeof text === 'string') {
        mocks.texts.push(text);
        mocks.textYs.push(this.y);
      }
      return this;
    }

    public registerFont(): this {
      return this;
    }
    public font(): this {
      return this;
    }
    public fontSize(): this {
      return this;
    }
    public fillColor(): this {
      return this;
    }
    public lineGap(): this {
      return this;
    }
    // Advances by a nominal line height so flow positions differ from the page origin.
    public moveDown(lines = 1): this {
      this.y += 12 * lines;
      return this;
    }
    public moveUp(): this {
      return this;
    }

    public end(): void {
      this.handlers['data']?.forEach((handler) => handler(Buffer.from('pdf')));
      this.handlers['end']?.forEach((handler) => handler());
    }
  }

  return { default: FakePDFDocument };
});

// Signature placement reads the PNG's IHDR size; image1.png is 261x80.
function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

vi.mock('fs', () => {
  const readFileSync = vi.fn((path: string) => (String(path).endsWith('.png') ? pngHeader(261, 80) : Buffer.from('font')));
  const existsSync = vi.fn(() => true);
  return { default: { readFileSync, existsSync }, readFileSync, existsSync };
});

import type { Request } from 'express';

import { VISA_LETTER_MANUAL_ERROR_CODE, VISA_LETTER_NOT_ISSUED_ERROR_CODE } from '@lfx-one/shared/constants';

import { AuthorizationError, MicroserviceError, ResourceNotFoundError } from '../errors';
import { VisaLetterService } from './visa-letter.service';

const EVENT_ID = 'a0A2M00000test1UAA';
const req = { path: '/api/events/visa-letter' } as unknown as Request;

interface LetterOverrides {
  hsTicketStatus?: string;
  isManualVisaLetter?: boolean;
  attendeeAccommodationPaidBy?: string;
  attendeeType?: string;
  country?: string;
  eventId?: string;
}

function letter(overrides: LetterOverrides = {}): Record<string, unknown> {
  return {
    id: 'vl-1',
    hsTicketStatus: overrides.hsTicketStatus ?? 'letter_issued',
    isManualVisaLetter: overrides.isManualVisaLetter ?? false,
    visaLetterIssuedDate: '2026-03-05T00:00:00.000Z',
    attendeeType: overrides.attendeeType ?? 'attendee',
    attendeeAccommodationPaidBy: overrides.attendeeAccommodationPaidBy ?? 'delegate',
    attendee: {
      nameAsPerPassport: 'Jane Doe',
      passportNumber: 'X1234567',
      birthDate: '1990-01-15',
      birthCountry: 'Canada',
      jobTitle: 'Engineer',
      contactNumber: '+1 555 0100',
      Account: { Name: 'Vendor Corp' },
      Address: { Street: '1 Main St', City: 'Toronto', State: 'ON', PostalCode: 'M5V 1A1', Country: 'Canada' },
    },
    event: {
      id: overrides.eventId ?? EVENT_ID,
      name: 'KubeCon Test 2026',
      startDate: '2026-03-10',
      endDate: '2026-03-12',
      city: 'Testville',
      country: overrides.country ?? 'United States',
    },
  };
}

function mockLetters(...letters: Record<string, unknown>[]): void {
  mocks.gatewayFetch.mockResolvedValue({ Data: letters });
}

function hasText(fragment: string): boolean {
  return mocks.texts.some((text) => text.includes(fragment));
}

describe('VisaLetterService', () => {
  let service: VisaLetterService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.images.length = 0;
    mocks.texts.length = 0;
    mocks.textYs.length = 0;
    mocks.getApiGatewayProfile.mockResolvedValue({ ID: '0032M00000sfid' });
    service = new VisaLetterService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fetches letter requests for the caller with the response body redacted', async () => {
    mockLetters(letter());

    const result = await service.generateVisaLetter(req, EVENT_ID);

    expect(mocks.gatewayFetch).toHaveBeenCalledWith(
      req,
      'https://gw.test/user-service/v1/users/0032M00000sfid/visaletterrequests',
      expect.objectContaining({ redactResponseBody: true })
    );
    expect(result.fileName).toBe('visa-letter-kubecon-test-2026-jane-doe.pdf');
    expect(result.pdf.length).toBeGreaterThan(0);
  });

  it('rejects when the profile has no Salesforce ID', async () => {
    mocks.getApiGatewayProfile.mockResolvedValue({});

    await expect(service.generateVisaLetter(req, EVENT_ID)).rejects.toBeInstanceOf(MicroserviceError);
    expect(mocks.gatewayFetch).not.toHaveBeenCalled();
  });

  it('throws not found when no request matches the event', async () => {
    mockLetters(letter({ eventId: 'other-event' }));

    await expect(service.generateVisaLetter(req, EVENT_ID)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('refuses a letter that has not been issued with the not-issued error code', async () => {
    mockLetters(letter({ hsTicketStatus: 'approved' }));

    const result = service.generateVisaLetter(req, EVENT_ID);
    await expect(result).rejects.toBeInstanceOf(AuthorizationError);
    await expect(result).rejects.toMatchObject({ code: VISA_LETTER_NOT_ISSUED_ERROR_CODE, statusCode: 403 });
  });

  it('refuses a manual letter with the manual error code', async () => {
    mockLetters(letter({ isManualVisaLetter: true }));

    await expect(service.generateVisaLetter(req, EVENT_ID)).rejects.toMatchObject({ code: VISA_LETTER_MANUAL_ERROR_CODE, statusCode: 403 });
  });

  it('prefers the issued request when the user applied more than once', async () => {
    mockLetters(letter({ hsTicketStatus: 'denied' }), letter());

    await expect(service.generateVisaLetter(req, EVENT_ID)).resolves.toBeDefined();
  });

  it('matches on the dev override event id outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('API_GW_DEV_EVENT_ID_OVERRIDE', 'dev-event');
    mockLetters(letter({ eventId: 'dev-event' }));

    await expect(service.generateVisaLetter(req, EVENT_ID)).resolves.toBeDefined();
  });

  it('ignores the dev override in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_GW_DEV_EVENT_ID_OVERRIDE', 'dev-event');
    mockLetters(letter({ eventId: 'dev-event' }));

    await expect(service.generateVisaLetter(req, EVENT_ID)).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  describe('letter content', () => {
    it('keeps the row for a field with no value so the next label does not overlap it', async () => {
      const blank = letter();
      (blank['attendee'] as Record<string, unknown>)['jobTitle'] = '';
      mockLetters(blank);

      await service.generateVisaLetter(req, EVENT_ID);

      expect(mocks.texts[mocks.texts.indexOf('Title:') + 1]).toBe(' ');
    });

    it('uses the default entity and US dates outside Europe, India and China', async () => {
      mockLetters(letter());

      await service.generateVisaLetter(req, EVENT_ID);

      expect(mocks.images[0].path).toMatch(/image2\.png$/);
      expect(hasText('Mar 05, 2026')).toBe(true);
      expect(hasText('Dear Embassy of United States:')).toBe(true);
      expect(hasText('to attend KubeCon Test 2026')).toBe(true);
    });

    it('uses LF Europe for a European event', async () => {
      mockLetters(letter({ country: 'Germany' }));

      await service.generateVisaLetter(req, EVENT_ID);

      expect(hasText('Linux Foundation Europe is pleased')).toBe(true);
    });

    it('uses LF India with day-first dates for an Indian event', async () => {
      mockLetters(letter({ country: 'India' }));

      await service.generateVisaLetter(req, EVENT_ID);

      expect(mocks.images[0].path).toMatch(/lf-india\.png$/);
      expect(hasText('05 March 2026')).toBe(true);
    });

    it('signs with the event name and drops the members link for a Chinese event', async () => {
      mockLetters(letter({ country: 'China' }));

      await service.generateVisaLetter(req, EVENT_ID);

      expect(mocks.images[0].options).toMatchObject({ width: 200 });
      expect(hasText('Executive Director\nKubeCon Test 2026')).toBe(true);
      expect(hasText('about/members')).toBe(false);
    });

    it.each([[undefined], ['2026-03-10']])('prints a single event date when the end date is %j', async (endDate) => {
      const singleDay = letter();
      (singleDay['event'] as Record<string, unknown>)['endDate'] = endDate;
      mockLetters(singleDay);

      await service.generateVisaLetter(req, EVENT_ID);

      expect(mocks.texts[mocks.texts.indexOf('Event Date:') + 1]).toBe('Mar 10, 2026');
    });

    it('starts the signatory block below the signature image', async () => {
      mockLetters(letter());

      await service.generateVisaLetter(req, EVENT_ID);

      const signature = mocks.images[1];
      const signatoryIndex = mocks.texts.findIndex((text) => text.startsWith('James R. Zemlin'));
      expect(signature.path).toMatch(/image1\.png$/);
      expect(mocks.textYs[signatoryIndex]).toBeCloseTo(signature.y + (110 * 80) / 261);
    });

    it('says the delegate will speak when they are a speaker', async () => {
      mockLetters(letter({ attendeeType: 'speaker' }));

      await service.generateVisaLetter(req, EVENT_ID);

      expect(hasText('to speak at KubeCon Test 2026')).toBe(true);
    });

    it.each([
      ['delegate', 'paid for by Jane Doe'],
      ['delegates_company', 'paid for by Vendor Corp'],
      ['the_linux_foundation', 'paid for by Linux Foundation'],
      ['cncf', 'paid for by CNCF'],
    ])('names the payer for %s', async (paidBy, expected) => {
      mockLetters(letter({ attendeeAccommodationPaidBy: paidBy }));

      await service.generateVisaLetter(req, EVENT_ID);

      expect(hasText(expected)).toBe(true);
    });
  });
});
