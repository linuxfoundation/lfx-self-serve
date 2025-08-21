// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingType } from '../../enums';
import { MeetingTemplateGroup } from '../../interfaces';

export { BOARD_TEMPLATES } from './board.constants';
export { MAINTAINERS_TEMPLATES } from './maintainers.constants';
export { MARKETING_TEMPLATES } from './marketing.constants';
export { TECHNICAL_TEMPLATES } from './technical.constants';
export { LEGAL_TEMPLATES } from './legal.constants';
export { OTHER_TEMPLATES } from './other.constants';

import { BOARD_TEMPLATES } from './board.constants';
import { MAINTAINERS_TEMPLATES } from './maintainers.constants';
import { MARKETING_TEMPLATES } from './marketing.constants';
import { TECHNICAL_TEMPLATES } from './technical.constants';
import { LEGAL_TEMPLATES } from './legal.constants';
import { OTHER_TEMPLATES } from './other.constants';

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
