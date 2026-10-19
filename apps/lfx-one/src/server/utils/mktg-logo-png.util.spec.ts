// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isRasterizableLogoSvg, rasterizeLogoSvg } from './mktg-logo-png.util';

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
});
