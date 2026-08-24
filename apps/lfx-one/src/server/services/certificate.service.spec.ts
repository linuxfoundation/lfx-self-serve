// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors brand-kit.service.spec.ts: shared modules are mocked because the `@lfx-one/shared/*`
// alias isn't wired into this app's vitest config. pdf.constants is aliased to its real source.
const snowflakeMocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

const pdfMocks = vi.hoisted(() => ({
  images: [] as { path: string; options: Record<string, unknown> | undefined }[],
}));

vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('./snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute: snowflakeMocks.execute }) },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// PDFKit is stubbed so assertions read the draw calls instead of parsing a rendered binary.
// `end()` synchronously fires the 'end' handler the service awaits.
vi.mock('pdfkit', () => {
  class FakePDFDocument {
    private handlers: Record<string, ((arg?: unknown) => void)[]> = {};

    public on(event: string, handler: (arg?: unknown) => void): this {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }

    public image(path: string, ...rest: unknown[]): this {
      const options = rest.find((arg) => typeof arg === 'object' && arg !== null) as Record<string, unknown> | undefined;
      pdfMocks.images.push({ path, options });
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
    public text(): this {
      return this;
    }
    public moveDown(): this {
      return this;
    }

    public end(): void {
      this.handlers['data']?.forEach((handler) => handler(Buffer.from('pdf')));
      this.handlers['end']?.forEach((handler) => handler());
    }
  }

  return { default: FakePDFDocument };
});

vi.mock('fs', () => {
  const readFileSync = vi.fn(() => Buffer.from('font'));
  const existsSync = vi.fn(() => true);
  return { default: { readFileSync, existsSync }, readFileSync, existsSync };
});

import type { Request } from 'express';

import { AuthorizationError, ResourceNotFoundError } from '../errors';
import { CertificateService } from './certificate.service';

const CNCF_PROJECT_ID = 'a0941000002wBz4AAE';
const LF_OPEN_SOURCE_LOGO = 'lfopensource-logo.png';
const TLF_LOGO = 'image2.png';
const CNCF_LOGO = 'cncf-logo.png';

const req = { path: '/api/events/certificate' } as unknown as Request;

interface RowOverrides {
  EVENT_COUNTRY?: string | null;
  EVENT_SOURCE?: string | null;
  PROJECT_ID?: string;
  USER_ATTENDED?: number | boolean | null;
}

function mockRow(overrides: RowOverrides = {}): void {
  snowflakeMocks.execute.mockResolvedValue({
    rows: [
      {
        EVENT_NAME: 'Test Event',
        EVENT_START_DATE: '2026-03-10T00:00:00.000Z',
        EVENT_END_DATE: '2026-03-12T00:00:00.000Z',
        EVENT_LOCATION: null,
        EVENT_CITY: 'Shanghai',
        EVENT_COUNTRY: 'China',
        EVENT_SOURCE: 'backfill',
        PROJECT_ID: 'a09410000000000AAA',
        USER_ATTENDED: true,
        ...overrides,
      },
    ],
  });
}

/** The letterhead logo is the first image drawn; the signature is the second. */
function drawnLogo(): { path: string; options: Record<string, unknown> | undefined } {
  return pdfMocks.images[0];
}

function drawnSignature(): { path: string; options: Record<string, unknown> | undefined } {
  return pdfMocks.images[1];
}

describe('CertificateService', () => {
  let service: CertificateService;

  beforeEach(() => {
    vi.clearAllMocks();
    pdfMocks.images = [];
    service = new CertificateService();
  });

  describe('LF Open Source logo override', () => {
    it('applies the LF Open Source logo for a backfill event in China', async () => {
      mockRow();

      await service.generateCertificate(req, { eventId: '-1', userEmail: 'attendee@example.com', userName: 'Test Attendee' });

      expect(drawnLogo().path).toContain(LF_OPEN_SOURCE_LOGO);
    });

    it('draws the override logo wider than the default so the wordmark stays legible', async () => {
      mockRow();

      await service.generateCertificate(req, { eventId: '-1', userEmail: 'attendee@example.com', userName: 'Test Attendee' });

      // The wordmark is ~13.6:1; at the default 145pt width it renders about 10pt tall.
      expect(drawnLogo().options?.['width']).toBe(240);
    });

    it('overrides a project template logo but keeps that project name and signature', async () => {
      // Real data: event -6, KubeCon + CloudNativeCon China 2026, owned by CNCF.
      mockRow({ PROJECT_ID: CNCF_PROJECT_ID });

      await service.generateCertificate(req, { eventId: '-6', userEmail: 'attendee@example.com', userName: 'Test Attendee' });

      expect(drawnLogo().path).toContain(LF_OPEN_SOURCE_LOGO);
      expect(drawnSignature().path).toContain('cncf-signature.png');
    });

    it.each([
      ['uppercase country', { EVENT_COUNTRY: 'CHINA' }],
      ['padded lowercase country', { EVENT_COUNTRY: ' china ' }],
      ['capitalised source', { EVENT_SOURCE: 'Backfill' }],
      ['padded source', { EVENT_SOURCE: ' BACKFILL ' }],
    ])('applies the override despite %s', async (_label, overrides) => {
      mockRow(overrides);

      await service.generateCertificate(req, { eventId: '-1', userEmail: 'attendee@example.com', userName: 'Test Attendee' });

      expect(drawnLogo().path).toContain(LF_OPEN_SOURCE_LOGO);
    });
  });

  describe('events that must keep their existing logo', () => {
    it.each([
      // 84 China events come from Bevy and must not pick up the override.
      ['a bevy-sourced China event', { EVENT_SOURCE: 'bevy' }],
      ['a cvent-sourced China event', { EVENT_SOURCE: 'cvent' }],
      // The one real non-China backfill event.
      ['a backfill event in France', { EVENT_COUNTRY: 'France' }],
      // Guards against a substring / LIKE '%china%' match.
      ['a Hong Kong event', { EVENT_COUNTRY: 'Hong Kong (SAR China)' }],
      ['a null source', { EVENT_SOURCE: null }],
      ['a null country', { EVENT_COUNTRY: null }],
    ])('keeps the default logo for %s', async (_label, overrides) => {
      mockRow(overrides);

      await service.generateCertificate(req, { eventId: 'evt-1', userEmail: 'attendee@example.com', userName: 'Test Attendee' });

      expect(drawnLogo().path).toContain(TLF_LOGO);
      expect(drawnLogo().options?.['width']).toBe(145);
    });

    it('keeps the CNCF logo for a non-matching CNCF event', async () => {
      mockRow({ PROJECT_ID: CNCF_PROJECT_ID, EVENT_SOURCE: 'cvent', EVENT_COUNTRY: 'United States' });

      await service.generateCertificate(req, { eventId: 'evt-2', userEmail: 'attendee@example.com', userName: 'Test Attendee' });

      expect(drawnLogo().path).toContain(CNCF_LOGO);
    });
  });

  describe('authorization and lookup', () => {
    it('throws AuthorizationError when the user did not attend', async () => {
      mockRow({ USER_ATTENDED: false });

      await expect(service.generateCertificate(req, { eventId: '-1', userEmail: 'attendee@example.com', userName: 'Test Attendee' })).rejects.toThrow(
        AuthorizationError
      );
    });

    it('throws ResourceNotFoundError when no registration row matches', async () => {
      snowflakeMocks.execute.mockResolvedValue({ rows: [] });

      await expect(service.generateCertificate(req, { eventId: 'missing', userEmail: 'attendee@example.com', userName: 'Test Attendee' })).rejects.toThrow(
        ResourceNotFoundError
      );
    });

    it('selects EVENT_SOURCE and binds the event id and email in order', async () => {
      mockRow();

      await service.generateCertificate(req, { eventId: '-1', userEmail: 'attendee@example.com', userName: 'Test Attendee' });

      const [sql, binds] = snowflakeMocks.execute.mock.calls[0];
      expect(sql).toContain('EVENT_SOURCE');
      expect((sql.match(/\?/g) ?? []).length).toBe(binds.length);
      expect(binds).toEqual(['-1', 'attendee@example.com']);
    });
  });
});
