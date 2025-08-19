// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingType } from '../../enums';
import { MeetingTemplate } from '../../interfaces';

export const MAINTAINERS_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'maintainers-weekly-sync',
    title: 'Weekly Maintainers Sync',
    meetingType: MeetingType.MAINTAINERS,
    estimatedDuration: 60,
    content: `Weekly Maintainers Sync

1. Project Status Update (10 min)
- Current sprint/milestone progress
- Key metrics and health indicators
- Community activity highlights

2. Pull Request & Issue Review (20 min)
- High-priority pull requests
- Critical issues and bug reports
- Code review assignments

3. Community Contributions (15 min)
- New contributor onboarding
- Community feedback and requests
- Contribution guidelines updates

4. Technical Decisions (10 min)
- Architecture and design discussions
- Library and dependency updates
- Security and performance considerations

5. Planning & Coordination (5 min)
- Upcoming releases and deadlines
- Task assignments and ownership
- Next week's priorities`,
  },
  {
    id: 'maintainers-release-planning',
    title: 'Release Planning Meeting',
    meetingType: MeetingType.MAINTAINERS,
    estimatedDuration: 70,
    content: `Release Planning Meeting

1. Release Scope Review (15 min)
- Feature requirements and specifications
- Bug fixes and improvements included
- Breaking changes and migration needs

2. Technical Readiness (20 min)
- Code completion status
- Testing coverage and quality metrics
- Documentation updates required

3. Community Impact Assessment (15 min)
- User experience improvements
- Backwards compatibility considerations
- Migration guides and support needed

4. Release Timeline (10 min)
- Development milestones and deadlines
- Testing and QA schedule
- Release candidate and stable release dates

5. Communication & Support (10 min)
- Release announcement planning
- Documentation and tutorial updates
- Community support preparation`,
  },
  {
    id: 'maintainers-architecture-review',
    title: 'Technical Architecture Review',
    meetingType: MeetingType.MAINTAINERS,
    estimatedDuration: 70,
    content: `Technical Architecture Review

1. Current Architecture Assessment (15 min)
- System performance and scalability
- Technical debt and maintenance burden
- Security and reliability status

2. Proposed Changes Discussion (25 min)
- New feature architecture proposals
- Infrastructure improvements
- Technology stack updates

3. Implementation Planning (15 min)
- Development approach and methodology
- Resource requirements and timeline
- Risk assessment and mitigation

4. Community Impact (10 min)
- Developer experience improvements
- API changes and backwards compatibility
- Documentation and migration support

5. Decision & Next Steps (5 min)
- Architecture decisions and approvals
- Implementation assignments
- Follow-up meetings and reviews`,
  },
];
