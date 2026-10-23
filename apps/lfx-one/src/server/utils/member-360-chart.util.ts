// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ENGAGEMENT_TIERS } from '@lfx-one/shared/constants/member-360.constants';
import type { Member360Envelope } from '@lfx-one/shared/interfaces/member-360.interface';
import JSZip from 'jszip';

import { MEMBER_360_CHART_NAMESPACES as ns } from '../constants/member-360-workbook.constants';
import { MicroserviceError } from '../errors';

/** ExcelJS has no chart writer. Add one native chart to its known Summary sheet. */
export async function addMember360SummaryChart(zip: JSZip, distribution: Member360Envelope['tabs']['summary']['tier_distribution']): Promise<void> {
  const sheet = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
  const rels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')?.async('string');
  const types = await zip.file('[Content_Types].xml')?.async('string');
  if (!sheet || !rels || !types || !sheet.includes('<tableParts')) {
    throw new MicroserviceError('The workbook Summary could not be prepared.', 500, 'MEMBER_360_WORKBOOK_INVALID', {
      operation: 'member_360_workbook',
      service: 'member_360_workbook',
    });
  }
  // Category labels are catalog constants, counts are validated numbers. No user
  // strings become chart markup or range formulas. The caches mirror A8:B12.
  const labels = ENGAGEMENT_TIERS.map((tier, i) => `<c:pt idx="${i}"><c:v>${tier}</c:v></c:pt>`).join('');
  const values = ENGAGEMENT_TIERS.map((tier, i) => `<c:pt idx="${i}"><c:v>${distribution[tier]}</c:v></c:pt>`).join('');
  zip.file(
    'xl/charts/chart1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${ns.chart}" xmlns:a="${ns.drawing}" xmlns:r="${ns.relationships}">
<c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/>
<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Member count</c:v></c:tx>
<c:cat><c:strRef><c:f>'Summary'!$A$8:$A$12</c:f><c:strCache><c:ptCount val="5"/>${labels}</c:strCache></c:strRef></c:cat>
<c:val><c:numRef><c:f>'Summary'!$B$8:$B$12</c:f><c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="5"/>${values}</c:numCache></c:numRef></c:val>
</c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart>
<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/><c:crosses val="max"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>
<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:axPos val="b"/><c:numFmt formatCode="0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="between"/><c:majorUnit val="1"/></c:valAx>
</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
  );
  zip.file(
    'xl/drawings/drawing1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${ns.spreadsheetDrawing}" xmlns:a="${ns.drawing}">
<xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="Tier distribution"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${ns.chart}">
<c:chart xmlns:c="${ns.chart}" xmlns:r="${ns.relationships}" r:id="rId1"/>
</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`
  );
  zip.file(
    'xl/drawings/_rels/drawing1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${ns.packageRelationships}"><Relationship Id="rId1" Type="${ns.relationships}/chart" Target="../charts/chart1.xml"/></Relationships>`
  );
  zip.file(
    'xl/worksheets/_rels/sheet1.xml.rels',
    rels.replace(
      '</Relationships>',
      `<Relationship Id="rIdMember360Chart" Type="${ns.relationships}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`
    )
  );
  // Drawing precedes tableParts in the worksheet schema; retain all table rels.
  zip.file('xl/worksheets/sheet1.xml', sheet.replace('<tableParts', '<drawing r:id="rIdMember360Chart"/><tableParts'));
  zip.file(
    '[Content_Types].xml',
    types.replace(
      '</Types>',
      '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
        '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'
    )
  );
}
