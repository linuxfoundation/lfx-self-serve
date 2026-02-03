// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { NpsGaugeSize } from '@lfx-one/shared/interfaces';
import { ChartModule } from 'primeng/chart';

interface BorderRadiusConfig {
  outerStart: number;
  outerEnd: number;
  innerStart: number;
  innerEnd: number;
}

interface GaugeChartData {
  labels: string[];
  datasets: {
    data: number[];
    backgroundColor: string[];
    borderWidth: number;
    borderRadius: (context: { dataIndex: number }) => BorderRadiusConfig | number;
    circumference: number;
    rotation: number;
  }[];
}

interface GaugeChartOptions {
  responsive: boolean;
  maintainAspectRatio: boolean;
  cutout: string;
  plugins: {
    legend: { display: boolean };
    tooltip: { enabled: boolean };
  };
}

interface GaugeSizeConfig {
  width: string;
  height: string;
  widthNum: number;
  heightNum: number;
  fontSize: string;
  labelSize: string;
  needleLength: number;
  needleWidth: number;
  centerY: number;
}

@Component({
  selector: 'lfx-nps-gauge',
  imports: [ChartModule],
  templateUrl: './nps-gauge.component.html',
})
export class NpsGaugeComponent {
  // === Inputs ===
  public readonly score = input.required<number>();
  public readonly size = input<NpsGaugeSize>('medium');

  // === Computed Signals ===
  protected readonly normalizedScore: Signal<number> = this.initNormalizedScore();
  protected readonly chartData: Signal<GaugeChartData> = this.initChartData();
  protected readonly chartOptions: Signal<GaugeChartOptions> = this.initChartOptions();
  protected readonly sizeConfig: Signal<GaugeSizeConfig> = this.initSizeConfig();
  protected readonly scoreColor: Signal<string> = this.initScoreColor();
  protected readonly scoreLabel: Signal<string> = this.initScoreLabel();
  protected readonly formattedScore: Signal<string> = this.initFormattedScore();
  protected readonly needleRotation: Signal<number> = this.initNeedleRotation();

  // === Private Initializers ===
  private initNormalizedScore(): Signal<number> {
    return computed(() => {
      const s = this.score();
      return Math.max(-100, Math.min(100, s));
    });
  }

  private initChartData(): Signal<GaugeChartData> {
    return computed(() => {
      const color = this.scoreColor();
      const normalized = this.normalizedScore();

      // Calculate fill percentage: map -100 to +100 range to 0-100%
      // -100 = 0%, 0 = 50%, +100 = 100%
      const fillPercentage = (normalized + 100) / 2;
      const unfilledPercentage = 100 - fillPercentage;

      return {
        labels: ['Score', 'Remaining'],
        datasets: [
          {
            data: [fillPercentage, unfilledPercentage],
            backgroundColor: [color, '#e2e8f0'], // Score color + gray background
            borderWidth: 0,
            // Scriptable borderRadius: round outer left and right edges only
            borderRadius: (context: { dataIndex: number }): BorderRadiusConfig | number => {
              const index = context.dataIndex;

              if (index === 0) {
                // First segment (filled) - round outer start only
                return { outerStart: 10, outerEnd: 0, innerStart: 10, innerEnd: 0 };
              } else if (index === 1) {
                // Second segment (unfilled/gray) - round outer end only
                return { outerStart: 0, outerEnd: 10, innerStart: 0, innerEnd: 10 };
              }
              return 0;
            },
            circumference: 180,
            rotation: -90,
          },
        ],
      };
    });
  }

  private initChartOptions(): Signal<GaugeChartOptions> {
    return computed(() => {
      return {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '90%', // Thinner gauge bar
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      };
    });
  }

  private initSizeConfig(): Signal<GaugeSizeConfig> {
    return computed(() => {
      const sizeConfigs: Record<NpsGaugeSize, GaugeSizeConfig> = {
        small: {
          width: '120px',
          height: '80px',
          widthNum: 120,
          heightNum: 80,
          fontSize: 'text-lg',
          labelSize: 'text-xs',
          needleLength: 40,
          needleWidth: 3,
          centerY: 68,
        },
        medium: {
          width: '180px',
          height: '115px',
          widthNum: 180,
          heightNum: 115,
          fontSize: 'text-xl',
          labelSize: 'text-sm',
          needleLength: 60,
          needleWidth: 4,
          centerY: 98,
        },
        large: {
          width: '240px',
          height: '150px',
          widthNum: 240,
          heightNum: 150,
          fontSize: 'text-2xl',
          labelSize: 'text-base',
          needleLength: 80,
          needleWidth: 5,
          centerY: 128,
        },
      };
      return sizeConfigs[this.size()];
    });
  }

  private initScoreColor(): Signal<string> {
    return computed(() => {
      const normalized = this.normalizedScore();
      if (normalized >= 50) return '#22c55e'; // green-500 (Excellent)
      if (normalized >= 0) return '#eab308'; // yellow-500 (Good)
      if (normalized >= -50) return '#f97316'; // orange-500 (Needs Improvement)
      return '#ef4444'; // red-500 (Critical)
    });
  }

  private initScoreLabel(): Signal<string> {
    return computed(() => {
      const normalized = this.normalizedScore();
      if (normalized >= 50) return 'Excellent';
      if (normalized >= 0) return 'Good';
      if (normalized >= -50) return 'Needs Improvement';
      return 'Critical';
    });
  }

  private initFormattedScore(): Signal<string> {
    return computed(() => {
      const normalized = this.normalizedScore();
      return normalized >= 0 ? `+${normalized}` : `${normalized}`;
    });
  }

  private initNeedleRotation(): Signal<number> {
    return computed(() => {
      const normalized = this.normalizedScore();
      // Map -100 to +100 to -90 to +90 degrees
      // -100 = -90deg (pointing left), 0 = 0deg (pointing up), +100 = +90deg (pointing right)
      return (normalized / 100) * 90;
    });
  }
}
