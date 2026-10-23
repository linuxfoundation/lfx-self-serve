// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ENGAGEMENT_TIERS } from '@lfx-one/shared/constants/member-360.constants';
import { member360Fixture } from '../../../e2e/fixtures/mock-data/member-360.mock';
import { addMember360SummaryChart } from './member-360-chart.util';
import { buildMember360Workbook } from './member-360-workbook.util';

async function xml(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  expect(file, path).not.toBeNull();
  return file ? file.async('string') : '';
}

describe('native Member 360 Summary chart package', () => {
  it('links sheet, drawing and chart with preserved table rels, native ranges and cached values', async () => {
    const envelope = member360Fixture();
    envelope.tabs.summary.tier_distribution = { Champion: 7, Engaged: 3, Passive: 2, 'At Risk': 1, Dormant: 0 };
    const bytes = await buildMember360Workbook(envelope);
    const zip = await JSZip.loadAsync(bytes);
    const sheet = await xml(zip, 'xl/worksheets/sheet1.xml');
    const sheetRels = await xml(zip, 'xl/worksheets/_rels/sheet1.xml.rels');
    const drawing = await xml(zip, 'xl/drawings/drawing1.xml');
    const drawingRels = await xml(zip, 'xl/drawings/_rels/drawing1.xml.rels');
    const chart = await xml(zip, 'xl/charts/chart1.xml');
    const types = await xml(zip, '[Content_Types].xml');
    expect(sheet).toContain('<drawing r:id="rIdMember360Chart"/><tableParts');
    expect(sheetRels).toContain('Id="rIdMember360Chart"');
    expect(sheetRels).toContain('/drawing" Target="../drawings/drawing1.xml"');
    expect(sheetRels.match(/\/table"/g)).toHaveLength(3);
    expect(drawing).toContain('r:id="rId1"');
    expect(drawing).toContain('<xdr:col>2</xdr:col>');
    expect(drawing).toContain('<xdr:row>5</xdr:row>');
    expect(drawing).toContain('<xdr:col>6</xdr:col>');
    expect(drawing).toContain('<xdr:row>15</xdr:row>');
    expect(drawingRels).toContain('Id="rId1"');
    expect(drawingRels).toContain('/chart" Target="../charts/chart1.xml"');
    expect(types).toContain('PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"');
    expect(types).toContain('PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"');
    expect(chart).toContain('<c:barDir val="bar"/>');
    expect(chart).toContain("<c:f>'Summary'!$A$8:$A$12</c:f>");
    expect(chart).toContain("<c:f>'Summary'!$B$8:$B$12</c:f>");
    for (const [index, tier] of ENGAGEMENT_TIERS.entries()) {
      expect(chart).toContain(`<c:pt idx="${index}"><c:v>${tier}</c:v></c:pt>`);
      expect(chart).toContain(`<c:pt idx="${index}"><c:v>${envelope.tabs.summary.tier_distribution[tier]}</c:v></c:pt>`);
    }
    expect(chart).toContain('<c:catAx><c:axId val="1"/>');
    expect(chart).toContain('<c:valAx><c:axId val="2"/>');
    expect(chart).toContain('<c:crossAx val="1"/>');
    expect(chart).toContain('<c:crossAx val="2"/>');
    const ids = [...sheetRels.matchAll(/\bId="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    // ExcelJS does not render charts but must tolerate every injected part.
    const reloaded = new ExcelJS.Workbook();
    await expect(reloaded.xlsx.load(bytes)).resolves.toBeDefined();
    expect(reloaded.getWorksheet('Summary')?.getTables()).toHaveLength(3);
    expect(reloaded.getWorksheet('Summary')?.getCell('B8').value).toBe(7);
    for (const entry of Object.values(zip.files)) {
      expect(entry.date.getTime()).toBe(new Date(`${envelope.run_date}T00:00:00Z`).getTime());
    }
  });
  it('does not manufacture a partially linked chart for an unexpected workbook layout', async () => {
    await expect(addMember360SummaryChart(new JSZip(), member360Fixture().tabs.summary.tier_distribution)).rejects.toMatchObject({
      statusCode: 500,
      code: 'MEMBER_360_WORKBOOK_INVALID',
    });
  });
});
