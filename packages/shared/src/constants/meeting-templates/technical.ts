// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingType } from '../../enums';
import { MeetingTemplate } from '../../interfaces';

export const TECHNICAL_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'technical-sprint-planning',
    title: 'Sprint Planning & Technical Review',
    meetingType: MeetingType.TECHNICAL,
    estimatedDuration: 70,
    content: `Sprint Planning & Technical Review

1. Sprint Review & Retrospective (15 min)
- Previous sprint accomplishments
- Velocity and capacity analysis
- Team feedback and process improvements

2. Technical Debt Assessment (20 min)
- Code quality and maintainability review
- Performance bottlenecks and optimization
- Security vulnerabilities and fixes

3. Feature Development Planning (20 min)
- User story refinement and estimation
- Technical implementation approaches
- Cross-team dependencies and coordination

4. Infrastructure & DevOps (10 min)
- CI/CD pipeline improvements
- Testing automation and coverage
- Deployment and monitoring updates

5. Sprint Commitment & Goals (5 min)
- Sprint goal definition
- Task assignments and ownership
- Success criteria and acceptance`,
  },
  {
    id: 'technical-api-design',
    title: 'API Design & Architecture Review',
    meetingType: MeetingType.TECHNICAL,
    estimatedDuration: 70,
    content: `API Design & Architecture Review

1. Current API Analysis (15 min)
- Usage metrics and performance data
- User feedback and pain points
- Compatibility and versioning status

2. Proposed API Changes (25 min)
- New endpoint specifications
- Breaking changes and migration plans
- Authentication and security updates

3. Implementation Details (15 min)
- Technical implementation approach
- Database and data model changes
- Testing and validation strategies

4. Documentation & Developer Experience (10 min)
- API documentation updates
- SDK and client library considerations
- Developer onboarding improvements

5. Release Planning & Timeline (5 min)
- Development and testing schedule
- Beta testing and feedback collection
- Production release planning`,
  },
  {
    id: 'technical-security-performance',
    title: 'Security & Performance Review',
    meetingType: MeetingType.TECHNICAL,
    estimatedDuration: 70,
    content: `Security & Performance Review

1. Security Assessment (20 min)
- Vulnerability scanning results
- Penetration testing findings
- Compliance and audit requirements

2. Performance Analysis (20 min)
- System performance metrics
- Load testing and capacity planning
- Database and query optimization

3. Infrastructure Security (15 min)
- Access control and authentication
- Network security and firewalls
- Data encryption and privacy

4. Incident Response & Monitoring (10 min)
- Security incident procedures
- Monitoring and alerting systems
- Backup and disaster recovery

5. Action Items & Implementation (5 min)
- Priority security fixes
- Performance optimization tasks
- Follow-up testing and validation`,
  },
];
