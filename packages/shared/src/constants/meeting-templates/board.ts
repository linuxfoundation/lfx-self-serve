// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingType } from '../../enums';
import { MeetingTemplate } from '../../interfaces';

export const BOARD_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'board-quarterly-review',
    title: 'Quarterly Board Review',
    meetingType: MeetingType.BOARD,
    estimatedDuration: 70,
    content: `Quarterly Board Review

1. Opening & Governance (10 min)
- Roll call and quorum confirmation
- Approval of previous meeting minutes
- Conflict of interest declarations

2. Executive Report (20 min)
- Project health and key metrics
- Financial overview and budget status
- Strategic initiatives progress

3. Key Decisions (25 min)
- Budget approvals and amendments
- Strategic direction discussions
- Policy updates and governance changes

4. Risk & Compliance (10 min)
- Risk assessment review
- Compliance status update
- Legal matters requiring board attention

5. Next Steps & Closing (5 min)
- Action item assignments
- Next meeting scheduling
- Adjournment`,
  },
  {
    id: 'board-strategic-planning',
    title: 'Strategic Planning Session',
    meetingType: MeetingType.BOARD,
    estimatedDuration: 75,
    content: `Strategic Planning Session

1. Current State Assessment (15 min)
- Project performance review
- Market position analysis
- Resource and capability assessment

2. Vision & Goals Setting (25 min)
- Long-term vision discussion
- Strategic objectives for next period
- Success metrics definition

3. Resource Planning (15 min)
- Budget allocation priorities
- Human resource requirements
- Infrastructure and technology needs

4. Implementation Planning (15 min)
- Timeline and milestone setting
- Responsibility assignments
- Risk mitigation strategies

5. Approval & Next Steps (5 min)
- Plan approval and ratification
- Communication strategy
- Follow-up meeting scheduling`,
  },
  {
    id: 'board-budget-review',
    title: 'Annual Budget Review',
    meetingType: MeetingType.BOARD,
    estimatedDuration: 70,
    content: `Annual Budget Review

1. Financial Overview (15 min)
- Current year financial performance
- Revenue sources and sustainability
- Expense analysis and trends

2. Budget Proposal Review (30 min)
- Proposed budget for next fiscal year
- Line-item discussion and justification
- Funding sources and allocation

3. Investment Priorities (10 min)
- Technology and infrastructure investments
- Human resource investments
- Strategic initiative funding

4. Approval Process (10 min)
- Budget amendments and modifications
- Formal budget approval
- Oversight and monitoring procedures

5. Implementation Planning (5 min)
- Budget rollout timeline
- Communication to stakeholders
- Quarterly review scheduling`,
  },
];
