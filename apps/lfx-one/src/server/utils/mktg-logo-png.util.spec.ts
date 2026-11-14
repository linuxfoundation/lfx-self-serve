// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Resvg } from '@resvg/resvg-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The shared utils barrel pulls Angular in (form.utils); the crop needs only the real brand-kit helper.
vi.mock('@lfx-one/shared/utils', async () => await vi.importActual('@lfx-one/shared/utils/brand-kit.utils'));

import { MKTG_SLIDES_EXPORT_LOGO_RENDER_TIMEOUT_MS } from '@lfx-one/shared/constants';
import { isRasterizableLogoSvg, limitConcurrent, rasterizeLogoSvg, readChildReply } from './mktg-logo-png.util';
import { logoVariantSources } from './mktg-logo-variants.util';

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(bytes);
  expect(view.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}

describe('isRasterizableLogoSvg', () => {
  it('takes an SVG that only references itself or embeds its images', () => {
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS} viewBox="0 0 10 3"><path d="M0 0h10v3H0z"/></svg>`)).toBe(true);
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS}><defs><path id="a" d="M0 0h1v1z"/></defs><use xlink:href="#a"/></svg>`)).toBe(true);
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS}><image href="data:image/png;base64,${ONE_PIXEL_PNG}"/></svg>`)).toBe(true);
    // An editor's namespace entities are plain text: harmless.
    expect(isRasterizableLogoSvg(`<!DOCTYPE svg [<!ENTITY ns_svg "http://www.w3.org/2000/svg">]><svg xmlns="&ns_svg;"/>`)).toBe(true);
  });

  it('refuses a reference the rasterizer would follow off the SVG: a path, a URL, an entity or a nested SVG', () => {
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS}><image href="/etc/logo.png"/></svg>`)).toBe(false);
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS}><image xlink:href='logo.png'/></svg>`)).toBe(false);
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS}><filter id="f"><feImage href="https://example.test/a.png"/></filter></svg>`)).toBe(false);
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS}><image href="&#47;etc&#47;logo.png"/></svg>`)).toBe(false);
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS}><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>`)).toBe(false);
    expect(isRasterizableLogoSvg(`<!DOCTYPE svg [<!ENTITY a '<image href="/etc/logo.png"/>'>]><svg ${SVG_NS}>&a;</svg>`)).toBe(false);
    expect(isRasterizableLogoSvg(`<!DOCTYPE svg [<!ENTITY a SYSTEM "file:///etc/passwd">]><svg ${SVG_NS}>&a;</svg>`)).toBe(false);
  });

  it('checks every href, so a decoy href inside another attribute cannot hide the real one', () => {
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS}><image data-x="href='#" href='/path/on/server.png' width="10" height="10"/></svg>`)).toBe(false);
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS}><image data-x='href="#' xlink:href="/path/on/server.png"/></svg>`)).toBe(false);
    expect(isRasterizableLogoSvg(`<svg ${SVG_NS}><image href\n=\n"/path/on/server.png"/></svg>`)).toBe(false);
  });

  it('reads an entity declaration to its real end, so a ">" in its quoted value cannot hide markup after it', () => {
    expect(isRasterizableLogoSvg(`<!DOCTYPE svg [<!ENTITY a "x>&#60;image hr&#101;f='/etc/logo.png'/&#62;">]><svg ${SVG_NS}>&a;</svg>`)).toBe(false);
    expect(isRasterizableLogoSvg(`<!DOCTYPE svg [<!ENTITY a "never closed`)).toBe(false);
  });
});

describe('rasterizeLogoSvg', () => {
  it('draws the logo as a PNG with its longest side at the drawing size', async () => {
    const wide = await rasterizeLogoSvg(`<svg ${SVG_NS} viewBox="0 0 400 100"><rect width="400" height="100" fill="#000"/></svg>`);
    const tall = await rasterizeLogoSvg(`<svg ${SVG_NS} width="50" height="100"><rect width="50" height="100" fill="#000"/></svg>`);

    expect(wide.reason).toBeNull();
    expect(pngSize(wide.png as Uint8Array)).toEqual({ width: 1200, height: 300 });
    expect(pngSize(tall.png as Uint8Array)).toEqual({ width: 600, height: 1200 });
  });

  it('answers why not, without drawing, for a refused or unreadable SVG', async () => {
    expect(await rasterizeLogoSvg(`<svg ${SVG_NS}><image href="/etc/logo.png" width="1" height="1"/></svg>`)).toMatchObject({
      png: null,
      reason: 'external-reference',
    });
    expect(await rasterizeLogoSvg('not an svg')).toMatchObject({ png: null, reason: 'unreadable' });
  });

  it('refuses a logo that sets live text, which draws as nothing without its font, and draws one whose text is outlined', async () => {
    const wordmark = (text: string): string => `<svg ${SVG_NS} viewBox="0 0 400 100"><rect width="40" height="40"/>${text}</svg>`;

    expect(await rasterizeLogoSvg(wordmark('<text x="50" y="60" font-size="40">Orbit</text>'))).toMatchObject({ png: null, reason: 'live-text' });
    expect(await rasterizeLogoSvg(wordmark('<g><svg:text xmlns:svg="http://www.w3.org/2000/svg">Orbit</svg:text></g>'))).toMatchObject({
      png: null,
      reason: 'live-text',
    });
    expect(await rasterizeLogoSvg(wordmark('<text><textPath href="#p">Orbit</textPath></text>'))).toMatchObject({ reason: 'live-text' });
    expect((await rasterizeLogoSvg(wordmark('<path d="M50 20h300v40H50z"/>'))).reason).toBeNull();
  });

  it('publishes a drawing with no painted pixel unless the caller requires ink, and then refuses it as blank', async () => {
    const empty = `<svg ${SVG_NS} viewBox="0 0 400 100"><rect width="400" height="100" fill="none"/></svg>`;
    const painted = `<svg ${SVG_NS} viewBox="0 0 400 100"><rect x="390" y="90" width="10" height="10" fill="#000"/></svg>`;

    // The primary's path is as it was: a transparent PNG is a PNG.
    expect((await rasterizeLogoSvg(empty)).reason).toBeNull();
    expect(await rasterizeLogoSvg(empty, { requireInk: true })).toEqual({ png: null, reason: 'blank', detail: '1200x300 with no painted pixel' });
    // One painted pixel, in the last corner the scan reaches, is ink.
    expect((await rasterizeLogoSvg(painted, { requireInk: true })).reason).toBeNull();
  });

  it('draws in a child the same bytes the rasterizer draws in this process', async () => {
    const lockup = `<svg ${SVG_NS} viewBox="0 0 20 10"><path d="M1 1h8v8H1z" fill="#1f6feb"/><path d="M11 5h8" stroke="#d62" stroke-width="2" fill="none"/></svg>`;
    const inProcess = new Resvg(lockup, { logLevel: 'off', font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: 1200 } }).render().asPng();
    const drawn = await rasterizeLogoSvg(lockup);
    expect(drawn.reason).toBeNull();
    expect(Buffer.from(drawn.png as Uint8Array).equals(inProcess)).toBe(true);
  });

  it('refuses a drawing over the published size as too big, through the child', async () => {
    vi.resetModules();
    vi.doMock('@lfx-one/shared/constants', async (importOriginal) => ({ ...(await importOriginal<object>()), MKTG_SLIDES_EXPORT_LOGO_MAX_BYTES: 100 }));
    const { rasterizeLogoSvg: withTinyCap } = await import('./mktg-logo-png.util');
    const drawn = await withTinyCap(`<svg ${SVG_NS} viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/></svg>`);
    vi.doUnmock('@lfx-one/shared/constants');
    expect(drawn).toMatchObject({ png: null, reason: 'too-big' });
    expect((drawn as { detail: string }).detail).toMatch(/^\d+ bytes$/);
  });

  describe('readChildReply', () => {
    it('takes the two shapes the child writes and nothing else', () => {
      expect(readChildReply('{"png":"AAAA"}\n')).toEqual({ png: 'AAAA' });
      expect(readChildReply('{"reason":"blank","detail":"1x1 with no painted pixel"}')).toEqual({ reason: 'blank', detail: '1x1 with no painted pixel' });
      for (const stdout of ['', 'null', '"x"', '42', '{}', '{"png":7}', '{"reason":"blank"}', '[1]', 'not json']) {
        expect(readChildReply(stdout), stdout).toEqual({ reason: 'render-failed', detail: `child answered unreadably: ${stdout}` });
      }
    });
  });

  describe('limitConcurrent', () => {
    it('runs at most the limit at once, in arrival order, and frees a slot when a task settles either way', async () => {
      const limited = limitConcurrent(3);
      let running = 0;
      let most = 0;
      const order: number[] = [];
      const releases: (() => void)[] = [];
      const task = (id: number, fail = false) =>
        limited(async () => {
          running += 1;
          most = Math.max(most, running);
          order.push(id);
          await new Promise<void>((resolve) => releases.push(resolve));
          running -= 1;
          if (fail) {
            throw new Error(`task ${id}`);
          }
          return id;
        });
      const settled = Promise.allSettled([task(1, true), task(2), task(3), task(4)]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(order).toEqual([1, 2, 3]);
      expect(releases).toHaveLength(3);
      releases[0]();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(order).toEqual([1, 2, 3, 4]);
      releases.splice(0).forEach((release) => release());
      const outcomes = await settled;
      expect(most).toBe(3);
      expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
    });

    it('hands the slot straight to the first waiter, so a caller arriving as a task settles queues behind it', async () => {
      const limited = limitConcurrent(1);
      let running = 0;
      let most = 0;
      const order: string[] = [];
      const releases: (() => void)[] = [];
      // Each task's own promise, once it runs, is held here: a `.then` on it runs in the microtask right after the limiter frees the slot.
      const bodies: Promise<void>[] = [];
      const task = (id: string) =>
        limited(() => {
          const body = new Promise<void>((resolve) => {
            running += 1;
            most = Math.max(most, running);
            order.push(id);
            releases.push(() => {
              running -= 1;
              resolve();
            });
          });
          bodies.push(body);
          return body;
        });
      const a = task('A');
      const b = task('B');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(order).toEqual(['A']);
      // C arrives in the microtask after A's body settles, when the slot is between A and B.
      const c = bodies[0].then(() => task('C'));
      releases[0]();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(order).toEqual(['A', 'B']);
      releases[1]();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(order).toEqual(['A', 'B', 'C']);
      releases[2]();
      await Promise.all([a, b, c]);
      expect(most).toBe(1);
    });
  });

  describe('the render child', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    /** A lockup whose own filtered or layered element lies far outside the symbol crop: the rasterizer aborts on the crop. */
    const crashing: { name: string; svg: string; symbolViewBox: string }[] = [
      {
        name: 'a user-space drop-shadow region on a rect in the right half, cropped to the left',
        svg: `<svg ${SVG_NS} viewBox="0 0 200 100"><defs><filter id="s" filterUnits="userSpaceOnUse" x="140" y="20" width="60" height="60"><feDropShadow dx="1" dy="1" stdDeviation="1"/></filter></defs><rect x="10" y="10" width="30" height="30" fill="#1f6feb"/><rect x="150" y="30" width="40" height="40" fill="#d62" filter="url(#s)"/></svg>`,
        symbolViewBox: '0 0 50 50',
      },
      {
        name: 'a nested svg outside the crop',
        svg: `<svg ${SVG_NS} viewBox="0 0 200 100"><rect x="10" y="10" width="30" height="30" fill="#1f6feb"/><svg x="150" y="60" width="40" height="30" viewBox="0 0 4 3"><rect width="4" height="3" fill="#d62"/></svg></svg>`,
        symbolViewBox: '0 0 50 50',
      },
      {
        name: 'a marker-end on a path at the far right',
        svg: `<svg ${SVG_NS} viewBox="0 0 500 200"><defs><marker id="m" markerWidth="6" markerHeight="6" refX="3" refY="3"><circle cx="3" cy="3" r="3" fill="#d62"/></marker></defs><rect x="20" y="20" width="100" height="100" fill="#1f6feb"/><path d="M450 100h40" stroke="#d62" stroke-width="4" marker-end="url(#m)"/></svg>`,
        symbolViewBox: '0 0 200 200',
      },
      {
        name: 'a use of a symbol with its own viewBox at the far right',
        svg: `<svg ${SVG_NS} viewBox="0 0 500 200"><defs><symbol id="y" viewBox="0 0 10 10"><rect width="10" height="10" fill="#d62"/></symbol></defs><rect x="20" y="20" width="100" height="100" fill="#1f6feb"/><use href="#y" x="450" y="80" width="40" height="40"/></svg>`,
        symbolViewBox: '0 0 200 200',
      },
      {
        name: 'an feFlood filter at the far right',
        svg: `<svg ${SVG_NS} viewBox="0 0 500 200"><defs><filter id="f" filterUnits="userSpaceOnUse" x="450" y="80" width="40" height="40"><feFlood flood-color="#d62"/></filter></defs><rect x="20" y="20" width="100" height="100" fill="#1f6feb"/><rect x="450" y="80" width="40" height="40" filter="url(#f)"/></svg>`,
        symbolViewBox: '0 0 200 200',
      },
    ];

    it.each(crashing)(
      'contains the rasterizer’s abort on the crop of a lockup with $name: the primary draws, the crop is render-failed, and this process lives',
      async ({ svg, symbolViewBox }) => {
        const primary = await rasterizeLogoSvg(svg);
        expect(primary.reason).toBeNull();
        const sources = logoVariantSources({ primary: { ref: 'logo.svg', svg }, stacked: null, symbol: null, reversed: null }, symbolViewBox);
        const crop = await rasterizeLogoSvg((sources.symbol as { svg: string }).svg, { requireInk: true });
        expect(crop.png).toBeNull();
        expect(crop.reason).toBe('render-failed');
        expect((crop as { detail: string }).detail).toMatch(/^child exited by SIG|^child exited \d+/);
      }
    );

    it(
      'kills a child that does not answer within the bound and says so',
      async () => {
        vi.stubEnv('MKTG_LOGO_RENDER_HANG_FOR_TEST', '1');
        const started = performance.now();
        const drawn = await rasterizeLogoSvg(`<svg ${SVG_NS} viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/></svg>`);
        const elapsed = performance.now() - started;
        expect(drawn).toEqual({ png: null, reason: 'render-failed', detail: 'child was killed at the time bound' });
        expect(elapsed).toBeGreaterThanOrEqual(MKTG_SLIDES_EXPORT_LOGO_RENDER_TIMEOUT_MS - 50);
        expect(elapsed).toBeLessThan(MKTG_SLIDES_EXPORT_LOGO_RENDER_TIMEOUT_MS + 2_000);
      },
      MKTG_SLIDES_EXPORT_LOGO_RENDER_TIMEOUT_MS + 5_000
    );
  });
});
