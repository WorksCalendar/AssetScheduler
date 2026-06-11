import { describe, it, expect } from 'vitest';
import { packLanes } from '../ganttLanes';

describe('packLanes', () => {
  it('keeps sequential intervals on a single lane', () => {
    const { lanes, laneCount } = packLanes([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
      { start: 10, end: 14 },
    ]);
    expect(laneCount).toBe(1);
    expect(lanes.every((l) => l.lane === 0)).toBe(true);
  });

  it('stacks overlapping intervals onto separate lanes', () => {
    const { lanes, laneCount } = packLanes([
      { start: 0, end: 10 },
      { start: 2, end: 8 }, // overlaps the first
      { start: 5, end: 12 }, // overlaps both
    ]);
    expect(laneCount).toBe(3);
    expect(new Set(lanes.map((l) => l.lane)).size).toBe(3);
  });

  it('reuses a freed lane once a bar ends', () => {
    const { lanes, laneCount } = packLanes([
      { start: 0, end: 4 },
      { start: 1, end: 3 }, // overlaps → lane 1
      { start: 5, end: 9 }, // after both end → back to lane 0
    ]);
    expect(laneCount).toBe(2);
    const byStart = [...lanes].sort((a, b) => a.item.start - b.item.start);
    expect(byStart[2]!.lane).toBe(0);
  });

  it('handles multi-day spans overlapping short jobs', () => {
    // A 3-day job (0..72h) with two short same-day jobs inside it.
    const { lanes, laneCount } = packLanes([
      { start: 0, end: 72 },
      { start: 6, end: 12 },
      { start: 30, end: 33 },
    ]);
    expect(laneCount).toBe(2);
    const big = lanes.find((l) => l.item.end === 72)!;
    expect(big.lane).toBe(0);
    expect(lanes.filter((l) => l.lane === 1)).toHaveLength(2);
  });

  it('touching intervals (end === next start) share a lane', () => {
    const { laneCount } = packLanes([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ]);
    expect(laneCount).toBe(1);
  });

  it('empty input yields no lanes', () => {
    expect(packLanes([])).toEqual({ lanes: [], laneCount: 0 });
  });

  it('preserves the original item payload', () => {
    const { lanes } = packLanes([{ start: 0, end: 1, id: 'a' }]);
    expect(lanes[0]!.item.id).toBe('a');
  });
});
