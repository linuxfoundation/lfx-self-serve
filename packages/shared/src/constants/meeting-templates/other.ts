// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingType } from '../../enums';
import { MeetingTemplate } from '../../interfaces';

export const OTHER_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'other-community-workshop',
    title: 'Community Workshop Planning',
    meetingType: MeetingType.OTHER,
    estimatedDuration: 70,
    content: `Community Workshop Planning

1. Workshop Objectives & Goals (15 min)
- Learning objectives and outcomes
- Target audience and skill levels
- Success metrics and evaluation

2. Content & Curriculum Development (25 min)
- Workshop structure and agenda
- Materials and resource preparation
- Hands-on exercises and activities

3. Logistics & Coordination (15 min)
- Venue and platform selection
- Registration and attendance management
- Technical setup and requirements

4. Speaker & Facilitator Coordination (10 min)
- Speaker recruitment and preparation
- Content review and feedback
- Backup plans and contingencies

5. Promotion & Follow-up (5 min)
- Marketing and outreach strategy
- Post-workshop feedback collection
- Community engagement opportunities`,
  },
  {
    id: 'other-project-retrospective',
    title: 'Project Retrospective & Planning',
    meetingType: MeetingType.OTHER,
    estimatedDuration: 70,
    content: `Project Retrospective & Planning

1. Project Review & Assessment (20 min)
- Accomplishments and milestones achieved
- Challenges and obstacles encountered
- Lessons learned and best practices

2. Community Feedback Analysis (20 min)
- User feedback and satisfaction surveys
- Contributor experience and engagement
- Adoption metrics and usage patterns

3. Future Planning & Roadmap (20 min)
- Strategic priorities and objectives
- Feature roadmap and development plans
- Community growth and engagement goals

4. Resource & Capacity Planning (10 min)
- Team capacity and skill assessment
- Budget and funding considerations
- Infrastructure and tooling needs

5. Action Items & Next Steps (5 min)
- Priority initiatives and projects
- Responsibility assignments
- Timeline and milestone planning`,
  },
  {
    id: 'other-cross-team-collaboration',
    title: 'Cross-Team Collaboration Meeting',
    meetingType: MeetingType.OTHER,
    estimatedDuration: 70,
    content: `Cross-Team Collaboration Meeting

1. Team Updates & Status (15 min)
- Current project status from each team
- Key accomplishments and milestones
- Upcoming priorities and deadlines

2. Collaboration Opportunities (25 min)
- Shared projects and initiatives
- Resource sharing and coordination
- Knowledge transfer and best practices

3. Communication & Process Improvement (15 min)
- Communication channels and tools
- Meeting cadence and effectiveness
- Documentation and information sharing

4. Conflict Resolution & Alignment (10 min)
- Priority conflicts and trade-offs
- Resource allocation discussions
- Decision-making processes

5. Action Items & Coordination (5 min)
- Cross-team action items
- Regular sync scheduling
- Escalation and communication protocols`,
  },
];
