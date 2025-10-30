// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { FOUNDATION_HEALTH_DATA } from '@lfx-one/shared/constants';
import { Foundation, OrgDependencyRiskLevel } from '@lfx-one/shared/interfaces';
import { hexToRgba } from '@lfx-one/shared/utils';

import { HealthScoreTagComponent } from '../health-score-tag/health-score-tag.component';

interface FoundationDisplay extends Foundation {
  softwareValueFormatted: string;
  totalMembersFormatted: string;
  activeContributorsAvg: string;
  maintainersAvg: string;
  eventsTotal: number;
  activeContributorsChartData: {
    labels: string[];
    datasets: {
      data: number[];
      borderColor: string;
      backgroundColor: string;
      fill: boolean;
      tension: number;
      borderWidth: number;
      pointRadius: number;
    }[];
  };
  maintainersChartData: {
    labels: string[];
    datasets: {
      data: number[];
      borderColor: string;
      backgroundColor: string;
      fill: boolean;
      tension: number;
      borderWidth: number;
      pointRadius: number;
    }[];
  };
  barHeights: number[];
  pieChartPaths: {
    otherPath: string;
    topPath: string;
  };
  orgDependencyColor: string;
  orgDependencyTextColorClass: string;
}

@Component({
  selector: 'lfx-foundation-health',
  imports: [CommonModule, ChartComponent, HealthScoreTagComponent],
  templateUrl: './foundation-health.component.html',
  styleUrl: './foundation-health.component.scss',
})
export class FoundationHealthComponent {
  /**
   * Optional callback for "View All" button
   */
  public onViewAll = input<() => void>();

  /**
   * Optional filter to show only specific foundation
   */
  public foundationFilter = input<string>();

  /**
   * Computed foundations with pre-calculated display values
   */
  public readonly foundations = computed<FoundationDisplay[]>(() => {
    const filter = this.foundationFilter();
    const filtered = filter ? FOUNDATION_HEALTH_DATA.filter((f) => f.id === filter) : FOUNDATION_HEALTH_DATA;

    return filtered.map((foundation) => ({
      ...foundation,
      softwareValueFormatted: this.formatSoftwareValue(foundation.softwareValue),
      totalMembersFormatted: foundation.totalMembers.toLocaleString(),
      activeContributorsAvg: this.calculateAverage(foundation.activeContributors).toLocaleString(),
      maintainersAvg: this.calculateAverage(foundation.maintainers).toLocaleString(),
      eventsTotal: this.calculateTotal(foundation.eventsMonthly),
      activeContributorsChartData: this.createSparklineData(foundation.activeContributors, '#009AFF'),
      maintainersChartData: this.createSparklineData(foundation.maintainers, '#009AFF'),
      barHeights: this.calculateBarHeights(foundation.eventsMonthly),
      pieChartPaths: this.createPieChartPaths(foundation.orgDependency.topOrgsPercentage),
      orgDependencyColor: this.getOrgDependencyColor(foundation.orgDependency.riskLevel),
      orgDependencyTextColorClass: this.getOrgDependencyTextColor(foundation.orgDependency.riskLevel),
    }));
  });

  /**
   * Sparkline chart options for contributor/maintainer charts
   */
  public readonly sparklineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { display: false },
      y: { display: false },
    },
  };

  /**
   * Format software value in millions to display format
   */
  private formatSoftwareValue(valueInMillions: number): string {
    if (valueInMillions >= 1000) {
      const billions = valueInMillions / 1000;
      return `${billions.toFixed(1)}B`;
    }
    return `${valueInMillions.toLocaleString()}M`;
  }

  /**
   * Calculate total from array of numbers
   */
  private calculateTotal(data: number[]): number {
    return data.reduce((sum, val) => sum + val, 0);
  }

  /**
   * Calculate average from array of numbers
   */
  private calculateAverage(data: number[]): number {
    return Math.round(data.reduce((sum, val) => sum + val, 0) / data.length);
  }

  /**
   * Create sparkline chart data for contributors or maintainers
   */
  private createSparklineData(data: number[], color: string) {
    return {
      labels: Array.from({ length: data.length }, (_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data,
          borderColor: color,
          backgroundColor: hexToRgba(color, 0.1),
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    };
  }

  /**
   * Calculate bar heights for monthly bar chart
   */
  private calculateBarHeights(data: number[]): number[] {
    const maxValue = Math.max(...data);
    const minValue = Math.min(...data);
    const range = maxValue - minValue;

    return data.map((value) => {
      if (range === 0) {
        return 50;
      }
      const heightPercent = ((value - minValue) / range) * 100;
      return Math.max(heightPercent, 10);
    });
  }

  /**
   * Get color for org dependency pie chart based on risk level
   */
  private getOrgDependencyColor(riskLevel: OrgDependencyRiskLevel): string {
    const riskColors: Record<OrgDependencyRiskLevel, string> = {
      low: '#0094FF',
      moderate: '#F59E0B',
      high: '#EF4444',
    };
    return riskColors[riskLevel];
  }

  /**
   * Get text color class for org dependency based on risk level
   */
  private getOrgDependencyTextColor(riskLevel: OrgDependencyRiskLevel): string {
    const colorMap: Record<OrgDependencyRiskLevel, string> = {
      low: 'text-[#0094FF]',
      moderate: 'text-amber-600',
      high: 'text-red-600',
    };
    return colorMap[riskLevel];
  }

  /**
   * Create SVG path for pie chart slice
   */
  private createPieSlice(startAngle: number, endAngle: number): string {
    const centerX = 20;
    const centerY = 20;
    const radius = 16;

    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((endAngle - 90) * Math.PI) / 180;

    const x1 = centerX + radius * Math.cos(startRad);
    const y1 = centerY + radius * Math.sin(startRad);
    const x2 = centerX + radius * Math.cos(endRad);
    const y2 = centerY + radius * Math.sin(endRad);

    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

    return `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  }

  /**
   * Create pie chart paths for org dependency visualization
   */
  private createPieChartPaths(topPercentage: number): { otherPath: string; topPath: string } {
    const otherAngle = 360 - topPercentage * 3.6;
    return {
      otherPath: this.createPieSlice(0, otherAngle),
      topPath: this.createPieSlice(otherAngle, 360),
    };
  }
}
