// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingType } from '../../enums';
import { MeetingTemplate } from '../../interfaces';

export const LEGAL_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'legal-compliance-risk',
    title: 'Compliance & Risk Assessment',
    meetingType: MeetingType.LEGAL,
    estimatedDuration: 70,
    content: `Compliance & Risk Assessment

1. Regulatory Compliance Review (20 min)
- Current compliance status assessment
- New regulatory requirements and changes
- Industry standards and best practices

2. Legal Risk Analysis (20 min)
- Intellectual property and licensing risks
- Data privacy and protection compliance
- Contract and agreement reviews

3. Policy & Procedure Updates (15 min)
- Code of conduct and community guidelines
- Contributor agreement and licensing
- Terms of service and privacy policy

4. Documentation & Record Keeping (10 min)
- Legal documentation maintenance
- Record retention and disposal policies
- Audit trail and compliance tracking

5. Action Items & Implementation (5 min)
- Priority compliance tasks
- Legal consultation requirements
- Policy communication and training`,
  },
  {
    id: 'legal-licensing-ip',
    title: 'Licensing & Intellectual Property',
    meetingType: MeetingType.LEGAL,
    estimatedDuration: 70,
    content: `Licensing & Intellectual Property

1. Current License Analysis (15 min)
- Open source license compliance
- Third-party dependency licensing
- License compatibility assessment

2. Intellectual Property Review (20 min)
- Copyright and trademark protection
- Patent considerations and freedom to operate
- Contributor intellectual property rights

3. License Strategy Planning (20 min)
- License selection and justification
- Dual licensing considerations
- Commercial licensing opportunities

4. Compliance Implementation (10 min)
- License header and notice requirements
- Attribution and acknowledgment procedures
- License violation response protocols

5. Documentation & Communication (5 min)
- License documentation updates
- Community communication strategy
- Legal consultation follow-up`,
  },
  {
    id: 'legal-contract-agreement',
    title: 'Contract & Agreement Review',
    meetingType: MeetingType.LEGAL,
    estimatedDuration: 70,
    content: `Contract & Agreement Review

1. Existing Agreements Assessment (15 min)
- Vendor and service provider contracts
- Partnership and collaboration agreements
- Employment and contractor agreements

2. New Agreement Evaluation (25 min)
- Contract terms and conditions review
- Risk assessment and mitigation
- Negotiation strategy and priorities

3. Compliance & Performance (15 min)
- Contract performance monitoring
- Service level agreement compliance
- Dispute resolution and management

4. Legal & Financial Implications (10 min)
- Cost and budget considerations
- Liability and insurance requirements
- Termination and transition planning

5. Approval & Next Steps (5 min)
- Contract approval recommendations
- Implementation and execution timeline
- Ongoing monitoring and review schedule`,
  },
];
