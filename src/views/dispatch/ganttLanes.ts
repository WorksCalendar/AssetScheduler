/**
 * Greedy interval lane packing for the dispatch Gantt.
 *
 * Places each interval in the first lane whose previous bar has already ended,
 * so overlapping (including multi-day) jobs stack vertically instead of
 * colliding on one row. Pure + deterministic.
 */
export interface Interval {
  /** Inclusive start (any monotonic unit — here, hours from the window origin). */
  start: number;
  /** Exclusive end. */
  end: number;
}

export interface Laned<T> {
  item: T;
  lane: number;
}

export function packLanes<T extends Interval>(items: readonly T[]): {
  lanes: Laned<T>[];
  laneCount: number;
} {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  const lanes: Laned<T>[] = sorted.map((item) => {
    // First lane free at this item's start (tiny epsilon so touching bars share a lane).
    let lane = laneEnds.findIndex((end) => end <= item.start + 1e-9);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    return { item, lane };
  });
  return { lanes, laneCount: laneEnds.length };
}
