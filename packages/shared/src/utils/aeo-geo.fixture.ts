// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Recorded 2.0 key-mode QA protocol/report structures, with synthetic identities and URLs.
// Raw author/task-parent metadata, fetched HTML and authentication headers are not copied.
import { AEO_GEO_FINALIZE_TOOL, AEO_GEO_QUESTIONS_HEADER } from '../constants/aeo-geo.constants';
import type { AeoGeoEnvelope, AeoGeoQuestionsTurn, AeoGeoReport } from '../interfaces/aeo-geo.interface';
import { recordedAeoGeoProjectEnvelope, recordedAeoGeoQuestions } from './__fixtures__/aeo-geo-project.fixture';
import { recordedAeoGeoDomainEnvelope } from './__fixtures__/aeo-geo-domain.fixture';

export function aeoGeoEnvelopeFixture(kind: 'project' | 'domain' = 'project'): AeoGeoEnvelope {
  return kind === 'project' ? recordedAeoGeoProjectEnvelope() : recordedAeoGeoDomainEnvelope();
}

export function aeoGeoQuestionsFixture(): AeoGeoQuestionsTurn {
  return recordedAeoGeoQuestions();
}

export function aeoGeoQuestionsEventFixture(type = 'agent_notification_message'): string {
  return JSON.stringify({
    type,
    created_at: '2026-10-19T10:00:01Z',
    content: {
      type: 'text',
      data: `${AEO_GEO_QUESTIONS_HEADER}\n\`\`\`json\n${JSON.stringify(aeoGeoQuestionsFixture(), null, 2)}\n\`\`\``,
    },
  });
}

export function aeoGeoFinalizeFixture(envelope: AeoGeoEnvelope): string {
  return JSON.stringify({
    type: 'llm_start',
    created_at: '2026-10-19T10:01:00Z',
    payload: {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'synthetic-finalize', name: AEO_GEO_FINALIZE_TOOL, input: {} }] },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'synthetic-finalize', content: JSON.stringify({ envelope_json: JSON.stringify(envelope) }) }],
        },
      ],
    },
  });
}

/** Keep the recorded report's full content; legacy equality tests can adapt its numeric header to their existing envelope. */
export function aeoGeoReportFixture(input?: Pick<AeoGeoEnvelope, 'scores' | 'overall_score' | 'verdict'>, pages?: string[]): AeoGeoReport {
  const report = aeoGeoEnvelopeFixture().report;
  if (!report) {
    throw new Error('Recorded report fixture is missing its typed view.');
  }
  if (input) {
    report.overall_score = input.overall_score;
    report.verdict = input.verdict;
    report.scorecard = report.scorecard.map((row) => ({ ...row, score: input.scores[row.key] }));
  }
  if (pages) {
    for (const url of pages) {
      const source = report.sources.find((entry) => entry.url === url);
      if (source) {
        source.role = 'audited';
      } else {
        report.sources.push({ url, role: 'audited' });
      }
    }
  }
  return report;
}
