// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const MEETING_PLATFORMS = [
  {
    value: 'zoom',
    label: 'Zoom',
    description: 'Video conferencing with recording and chat features',
    available: true,
    icon: 'fa-light fa-video',
    color: '#0094FF',
  },
  {
    value: 'teams',
    label: 'Microsoft Teams',
    description: 'Integrated collaboration with Office 365',
    available: false,
    icon: 'fa-light fa-desktop',
    color: '#6b7280',
  },
  {
    value: 'in-person',
    label: 'In-Person',
    description: 'Physical meeting location',
    available: false,
    icon: 'fa-light fa-location-dot',
    color: '#6b7280',
  },
];

export const MEETING_FEATURES = [
  {
    key: 'recording_enabled',
    icon: 'fa-light fa-video',
    title: 'Enable Recording',
    description: 'Record the meeting for those who cannot attend live',
    recommended: true,
    color: '#3b82f6', // blue - matches bg-blue-50 text-blue-700
  },
  {
    key: 'transcripts_enabled',
    icon: 'fa-light fa-file-lines',
    title: 'Generate Transcripts',
    description: 'Automatically create searchable text transcripts',
    recommended: false,
    color: '#8b5cf6', // purple - matches bg-purple-50 text-purple-700
  },
  {
    key: 'youtube_enabled',
    icon: 'fa-light fa-upload',
    title: 'YouTube Auto-upload',
    description: "Automatically publish recordings to your project's YouTube channel",
    recommended: false,
    color: '#dc2626', // red - matches bg-red-50 text-red-700
  },
  {
    key: 'zoom_ai_enabled',
    icon: 'fa-light fa-microchip-ai',
    title: 'AI Meeting Summary',
    description: 'Generate key takeaways and action items automatically',
    recommended: true,
    color: '#16a34a', // green - matches bg-green-50 text-green-700
  },
  {
    key: 'show_in_public_calendar',
    icon: 'fa-light fa-calendar-check',
    title: 'Show in Public Calendar',
    description: 'Make this meeting visible in the public project calendar',
    recommended: true,
    color: '#ea580c', // orange - unique color for calendar visibility
  },
];

export const RECORDING_ACCESS_OPTIONS = [
  { label: 'Members Only', value: 'Members' },
  { label: 'Public', value: 'Public' },
  { label: 'Private', value: 'Private' },
];

export const AI_SUMMARY_ACCESS_OPTIONS = [
  { label: 'PCC Members', value: 'PCC' },
  { label: 'Project Members', value: 'Members' },
  { label: 'Public', value: 'Public' },
];
