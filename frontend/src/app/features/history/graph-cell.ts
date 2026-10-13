import { Component, computed, inject, input } from '@angular/core';
import { GraphRow } from '../../core/models/repository';
import { GravatarService } from '../../core/services/gravatar.service';

/** Row height and lane spacing of the graph, in px. */
export const ROW = 32;
export const LANE = 24;
const PAD = 14;
const LANE_COLORS = 8;
/** A commit's disc, wide enough for its author's initials. */
export const NODE = 11;
const MERGE = 4.5;
/** The picture inside the disc's coloured ring. */
const PICTURE = NODE - 1.5;
/** Tells each cell's clip path from the others'. */
let cells = 0;

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

/**
 * One row of the commit graph: the lines crossing it, a band of the commit's colour from
 * it to the message, and the commit: its author's picture or initials, a small dot for a
 * merge, a dashed box for a stash.
 */
@Component({
  selector: 'app-graph-cell',
  template: `
    <svg [attr.width]="width()" [attr.height]="height" aria-hidden="true">
      <rect
        class="band"
        [attr.x]="cx()"
        y="3"
        [attr.width]="width() - cx()"
        [attr.height]="height - 6"
        [style.fill]="color()"
      />
      @if (labeled()) {
        <path class="tie" [attr.d]="'M0 ' + height / 2 + 'H' + cx()" [style.stroke]="color()" />
      }
      @for (line of lines(); track $index) {
        <path [attr.d]="line.d" [style.stroke]="line.color" />
      }
      @if (fromWip()) {
        <path class="wip" [attr.d]="'M' + cx() + ' 0V' + height / 2" [style.stroke]="color()" />
      }
      @if (stash()) {
        <rect
          class="stash"
          [attr.x]="cx() - stashSide / 2"
          [attr.y]="height / 2 - stashSide / 2"
          [attr.width]="stashSide"
          [attr.height]="stashSide"
          rx="4"
          [style.stroke]="color()"
        />
      } @else if (merge()) {
        <circle
          class="merge"
          [attr.cx]="cx()"
          [attr.cy]="height / 2"
          [attr.r]="mergeR"
          [style.stroke]="color()"
        />
      } @else {
        <circle [attr.cx]="cx()" [attr.cy]="height / 2" [attr.r]="nodeR" [style.fill]="color()" />
        @if (picture(); as picture) {
          <clipPath [attr.id]="clipId">
            <circle [attr.cx]="cx()" [attr.cy]="height / 2" [attr.r]="pictureR" />
          </clipPath>
          <image
            [attr.href]="picture"
            [attr.x]="cx() - pictureR"
            [attr.y]="height / 2 - pictureR"
            [attr.width]="pictureR * 2"
            [attr.height]="pictureR * 2"
            [attr.clip-path]="'url(#' + clipId + ')'"
            preserveAspectRatio="xMidYMid slice"
            (error)="gravatar.notFound(email())"
          />
        } @else {
          <text [attr.x]="cx()" [attr.y]="height / 2">{{ initials() }}</text>
        }
      }
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
    .band {
      opacity: 0.1;
    }
    :host(.selected) .band {
      opacity: 0.24;
    }
    .tie {
      stroke-width: 1;
      opacity: 0.6;
    }
    .wip {
      stroke-dasharray: 3 3;
    }
    .stash {
      fill: var(--r-base);
      stroke-width: 2;
      stroke-dasharray: 3 2;
    }
    .merge {
      fill: var(--r-base);
      stroke-width: 2.5;
    }
    text {
      fill: var(--r-on-accent);
      font: 700 9px var(--r-font);
      text-anchor: middle;
      dominant-baseline: central;
    }
  `,
})
export class GraphCell {
  protected readonly gravatar = inject(GravatarService);
  readonly row = input.required<GraphRow>();
  readonly width = input.required<number>();
  readonly initials = input('');
  /** The author's, for their picture. */
  readonly email = input('');
  /** A merge commit: a dot, the branches it joins tell the story. */
  readonly merge = input(false);
  /** A stash: a dashed box, hanging on the commit it was made on. */
  readonly stash = input(false);
  /** Names point at this commit: a thin line ties them to it. */
  readonly labeled = input(false);
  /** The working tree's changes sit above this commit (HEAD): a dashed line from them. */
  readonly fromWip = input(false);
  protected readonly height = ROW;
  protected readonly nodeR = NODE;
  protected readonly mergeR = MERGE;
  protected readonly pictureR = PICTURE;
  protected readonly clipId = `node-${++cells}`;
  protected readonly picture = computed(() => this.gravatar.url(this.email()));
  protected readonly stashSide = NODE * 1.7;
  protected readonly color = computed(() => laneColor(this.row().lane));
  protected readonly cx = computed(() => laneX(this.row().lane));

  protected readonly lines = computed<Line[]>(() => {
    const { lane, through, into, out } = this.row();
    const h = ROW;
    const r = this.merge() ? MERGE : this.stash() ? NODE * 0.85 : NODE;
    const x = laneX;
    const lines: Line[] = through.map((l) => ({ d: `M${x(l)} 0V${h}`, color: laneColor(l) }));
    for (const j of into) {
      const d =
        j === lane
          ? `M${x(j)} 0V${h / 2 - r}`
          : `M${x(j)} 0C${x(j)} ${h * 0.35} ${x(lane)} ${h * 0.15} ${x(lane)} ${h / 2}`;
      lines.push({ d, color: laneColor(j) });
    }
    for (const k of out) {
      const d =
        k === lane
          ? `M${x(lane)} ${h / 2 + r}V${h}`
          : `M${x(lane)} ${h / 2}C${x(lane)} ${h * 0.85} ${x(k)} ${h * 0.65} ${x(k)} ${h}`;
      lines.push({ d, color: laneColor(k) });
    }
    return lines;
  });
}
