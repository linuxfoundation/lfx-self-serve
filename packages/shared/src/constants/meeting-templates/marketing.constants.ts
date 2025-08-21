// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingType } from '../../enums';
import { MeetingTemplate } from '../../interfaces';

export const MARKETING_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'marketing-community-growth',
    title: 'Community Growth Strategy',
    meetingType: MeetingType.MARKETING,
    estimatedDuration: 70,
    content: `Community Growth Strategy

1. Current Community Analysis (15 min)
- User engagement metrics and trends
- Community platform performance
- User feedback and satisfaction surveys

2. Growth Initiatives Planning (25 min)
- Content marketing strategy
- Event planning and conference participation
- Partnership and collaboration opportunities

3. Campaign Development (15 min)
- Social media campaign planning
- Documentation and tutorial improvements
- Community recognition programs

4. Outreach & Partnerships (10 min)
- Industry partnerships and integrations
- Educational institution engagement
- Corporate adoption strategies

5. Metrics & Success Tracking (5 min)
- KPI definition and tracking
- ROI measurement approaches
- Quarterly goal setting`,
  },
  {
    id: 'marketing-content-strategy',
    title: 'Content & Documentation Strategy',
    meetingType: MeetingType.MARKETING,
    estimatedDuration: 70,
    content: `Content & Documentation Strategy

1. Content Audit & Analysis (15 min)
- Existing content performance review
- User journey and pain point analysis
- Content gap identification

2. Documentation Planning (20 min)
- User guide improvements
- API documentation updates
- Tutorial and example development

3. Content Creation Strategy (20 min)
- Blog post and article planning
- Video and multimedia content
- Community-generated content programs

4. Distribution & Promotion (10 min)
- Website and platform optimization
- Social media distribution strategy
- Email marketing and newsletters

5. Community Engagement (5 min)
- User feedback collection
- Community contributor recognition
- Content collaboration opportunities`,
  },
  {
    id: 'marketing-event-planning',
    title: 'Event & Conference Planning',
    meetingType: MeetingType.MARKETING,
    estimatedDuration: 70,
    content: `Event & Conference Planning

1. Event Strategy & Goals (15 min)
- Participation objectives and outcomes
- Target audience and user personas
- Brand positioning and messaging

2. Event Selection & Planning (25 min)
- Conference and meetup opportunities
- Speaking engagements and presentations
- Booth and sponsor considerations

3. Content & Materials Preparation (15 min)
- Presentation and demo development
- Marketing materials and swag
- Documentation and handout creation

4. Community Coordination (10 min)
- Volunteer and speaker coordination
- Travel and logistics planning
- Budget and resource allocation

5. Follow-up & Measurement (5 min)
- Lead capture and follow-up strategy
- Success metrics and ROI tracking
- Post-event community engagement`,
  },
];
