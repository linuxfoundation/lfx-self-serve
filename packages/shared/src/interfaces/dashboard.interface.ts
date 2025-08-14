// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface TableData {
  id: string | number;
  title: string;
  url: string;
  status: string;
  date: string | null;
}

export interface ProjectStats {
  totalMembers: number;
  totalCommittees: number;
  totalMeetings: number;
  upcomingMeetings: number;
  publicMeetings: number;
  privateMeetings: number;
}

export interface ProjectHealth {
  activityScore: number;
  avgMembersPerCommittee: number;
  meetingFrequency: number;
  committeeUtilization: number;
  recentCommitteeUpdates: number;
  recentMeetings: number;
}
