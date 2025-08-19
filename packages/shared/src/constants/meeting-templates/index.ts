// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingType } from '../../enums';
import { MeetingTemplateGroup } from '../../interfaces';

export { BOARD_TEMPLATES } from './board';
export { MAINTAINERS_TEMPLATES } from './maintainers';
export { MARKETING_TEMPLATES } from './marketing';
export { TECHNICAL_TEMPLATES } from './technical';
export { LEGAL_TEMPLATES } from './legal';
export { OTHER_TEMPLATES } from './other';

import { BOARD_TEMPLATES } from './board';
import { MAINTAINERS_TEMPLATES } from './maintainers';
import { MARKETING_TEMPLATES } from './marketing';
import { TECHNICAL_TEMPLATES } from './technical';
import { LEGAL_TEMPLATES } from './legal';
import { OTHER_TEMPLATES } from './other';

export const MEETING_TEMPLATES: MeetingTemplateGroup[] = [
  {
    meetingType: MeetingType.BOARD,
    templates: BOARD_TEMPLATES,
  },
  {
    meetingType: MeetingType.MAINTAINERS,
    templates: MAINTAINERS_TEMPLATES,
  },
  {
    meetingType: MeetingType.MARKETING,
    templates: MARKETING_TEMPLATES,
  },
  {
    meetingType: MeetingType.TECHNICAL,
    templates: TECHNICAL_TEMPLATES,
  },
  {
    meetingType: MeetingType.LEGAL,
    templates: LEGAL_TEMPLATES,
  },
  {
    meetingType: MeetingType.OTHER,
    templates: OTHER_TEMPLATES,
  },
];
