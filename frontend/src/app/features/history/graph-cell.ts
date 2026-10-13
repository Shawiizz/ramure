import { Component, computed, input } from '@angular/core';
import { GraphRow } from '../../core/models/repository';

/** Row height and lane spacing of the graph, in px. */
export const ROW = 30;
export const LANE = 14;
const PAD = 10;
const LANE_COLORS = 8;

export function laneColor(lane: number): string {
  return `var(--r-lane-${lane % LANE_COLORS})`;
}

/** The middle of a lane, from the graph's left edge. */
export function laneX(lane: number): number {
  return PAD + lane * LANE;
}

/** Width of a graph column holding `lanes` lanes. */
export function graphWidth(lanes: number): number {
  return PAD * 2 + Math.max(lanes - 1, 0) * LANE;
}

interface Line {
  d: string;
  color: string;
}

/** One row of the commit graph: the lines crossing it and the commit's dot. */
@Component({
  selector: 'app-graph-cell',
  template: `
    <svg [attr.width]="width()" [attr.height]="height" aria-hidden="true">
      @for (line of lines(); track $index) {
        <path [attr.d]="line.d" [style.stroke]="line.color" />
      }
      @if (fromWip()) {
        <path
          class="wip"
          [attr.d]="'M' + x(row().lane) + ' 0V' + height / 2"
          [style.stroke]="color()"
        />
      }
      <circle [attr.cx]="x(row().lane)" [attr.cy]="height / 2" r="4.5" [style.stroke]="color()" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
    }
    path {
      fill: none;
      stroke-width: 2;
    }
    circle {
      fill: var(--r-commit);
      stroke-width: 2;
    }
    .wip {
      stroke-dasharray: 3 3;
    }
  `,
})
export class GraphCell {
  readonly row = input.required<GraphRow>();
  readonly width = input.required<number>();
  /** The working tree's changes sit above this commit (HEAD): a dashed line from them. */
  readonly fromWip = input(false);
  protected readonly height = ROW;
  protected readonly color = computed(() => laneColor(this.row().lane));

  protected readonly lines = computed<Line[]>(() => {
    const { lane, through, into, out } = this.row();
    const h = ROW;
    const x = (l: number) => this.x(l);
    const lines: Line[] = through.map((l) => ({ d: `M${x(l)} 0V${h}`, color: laneColor(l) }));
    for (const j of into) {
      const d =
        j === lane
          ? `M${x(j)} 0V${h / 2}`
          : `M${x(j)} 0C${x(j)} ${h * 0.35} ${x(lane)} ${h * 0.15} ${x(lane)} ${h / 2}`;
      lines.push({ d, color: laneColor(j) });
    }
    for (const k of out) {
      const d =
        k === lane
          ? `M${x(lane)} ${h / 2}V${h}`
          : `M${x(lane)} ${h / 2}C${x(lane)} ${h * 0.85} ${x(k)} ${h * 0.65} ${x(k)} ${h}`;
      lines.push({ d, color: laneColor(k) });
    }
    return lines;
  });

  protected x(lane: number): number {
    return laneX(lane);
  }
}
