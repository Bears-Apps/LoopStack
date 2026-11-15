import type { AgpChart } from './clinicReport';

// Geometry for the AGP chart, shared by every renderer. The screen and the
// HTML export draw it as SVG paths, the PDF as jsPDF polygons; all three take
// their points from here, so the chart cannot differ between them. Values come
// from the report model; this only maps them onto a plot.

export type Pt = [number, number];

export type AgpPlot = {
  /** Plot area inside the given box (axes labels sit outside it). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** One closed polygon per run of populated bins. */
  outer: Pt[][];
  inner: Pt[][];
  median: Pt[][];
  lowY: number;
  highY: number;
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
};

export const AGP_Y_MIN = 40;

export function agpPlot(chart: AgpChart, box: { width: number; height: number; left?: number; top?: number }): AgpPlot {
  const left = box.left ?? 0;
  const top = box.top ?? 0;
  const x = (minute: number) => left + (minute / (24 * 60)) * box.width;
  const y = (mgdl: number) => top + box.height - ((Math.min(chart.yMax, Math.max(AGP_Y_MIN, mgdl)) - AGP_Y_MIN) / (chart.yMax - AGP_Y_MIN)) * box.height;

  // Contiguous runs of bins with values; a gap in the data is a gap in the chart.
  const runs: AgpChart['bins'][] = [];
  let run: AgpChart['bins'] = [];
  for (const b of chart.bins) {
    if (b.p5 == null || b.p25 == null || b.p50 == null || b.p75 == null || b.p95 == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(b);
  }
  if (run.length) runs.push(run);

  const band = (lo: 'p5' | 'p25', hi: 'p95' | 'p75') =>
    runs.map((r) => [
      ...r.map((b): Pt => [x(b.minute), y(b[hi] as number)]),
      ...[...r].reverse().map((b): Pt => [x(b.minute), y(b[lo] as number)]),
    ]);

  const yTicks: AgpPlot['yTicks'] = [];
  for (let v = 50; v <= chart.yMax; v += 50) yTicks.push({ y: y(v), label: String(v) });
  const xTicks: AgpPlot['xTicks'] = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => ({
    x: x(h * 60),
    label: h === 0 || h === 24 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`,
  }));

  return {
    left,
    top,
    width: box.width,
    height: box.height,
    outer: band('p5', 'p95'),
    inner: band('p25', 'p75'),
    median: runs.map((r) => r.map((b): Pt => [x(b.minute), y(b.p50 as number)])),
    lowY: y(chart.lowMgdl),
    highY: y(chart.highMgdl),
    yTicks,
    xTicks,
  };
}

const f = (n: number) => Math.round(n * 10) / 10;

/** SVG path data for a polygon (closed) or polyline (open). */
export function svgPath(points: Pt[], closed: boolean): string {
  return points.map(([px, py], i) => `${i ? 'L' : 'M'}${f(px)} ${f(py)}`).join('') + (closed ? 'Z' : '');
}
