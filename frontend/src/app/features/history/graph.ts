import { GraphRow } from '../../core/models/repository';

/** Row height and lane spacing of the graph, in px. */
export const ROW = 32;
export const LANE = 24;
const PAD = 14;
const LANE_COLORS = 8;
/** A commit's disc, wide enough for its author's initials. */
export const NODE = 11;
export const MERGE = 4.5;
/** The picture inside the disc's coloured ring. */
export const PICTURE = NODE - 1.5;
/** A stash's dashed box. */
export const STASH = NODE * 1.7;

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

/** A commit's mark: its author's disc, a small dot for a merge, a dashed box for a stash. */
export type Node = 'commit' | 'merge' | 'stash';

/** One row of the graph, drawn once for the whole history: the lines crossing it, its commit. */
export interface Shape {
  cx: number;
  color: string;
  node: Node;
  paths: { d: string; color: string }[];
}

export function shape(row: GraphRow, node: Node): Shape {
  const { lane, through, into, out } = row;
  const h = ROW;
  const r = node === 'merge' ? MERGE : node === 'stash' ? NODE * 0.85 : NODE;
  const x = laneX;
  const paths = through.map((l) => ({ d: `M${x(l)} 0V${h}`, color: laneColor(l) }));
  for (const j of into) {
    const d =
      j === lane
        ? `M${x(j)} 0V${h / 2 - r}`
        : `M${x(j)} 0C${x(j)} ${h * 0.35} ${x(lane)} ${h * 0.15} ${x(lane)} ${h / 2}`;
    paths.push({ d, color: laneColor(j) });
  }
  for (const k of out) {
    const d =
      k === lane
        ? `M${x(lane)} ${h / 2 + r}V${h}`
        : `M${x(lane)} ${h / 2}C${x(lane)} ${h * 0.85} ${x(k)} ${h * 0.65} ${x(k)} ${h}`;
    paths.push({ d, color: laneColor(k) });
  }
  return { cx: x(lane), color: laneColor(lane), node, paths };
}
