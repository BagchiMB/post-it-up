import { usd } from '../lib/format';

/** Spend per day: a tiny SVG bar chart (same geometry as the server-rendered one). */
export function BarChart({ byDay }: { byDay: { day: string; cost: number; calls: number }[] }) {
  const W = 720;
  const H = 180;
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const max = Math.max(0.01, ...byDay.map((d) => d.cost));
  const bw = (W - pad.l - pad.r) / Math.max(1, byDay.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Spend per day, last ${byDay.length} days`}>
      <line x1={pad.l} x2={W - pad.r} y1={y(max)} y2={y(max)} />
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
      <text x={pad.l - 6} y={y(max) + 4} textAnchor="end">
        {usd(max)}
      </text>
      <text x={pad.l - 6} y={y(0) + 4} textAnchor="end">
        $0
      </text>
      {byDay.map((d, i) => {
        const top = y(d.cost);
        return (
          <rect
            key={d.day}
            className="bar"
            x={(pad.l + i * bw + 1).toFixed(1)}
            y={top.toFixed(1)}
            width={Math.max(1, bw - 2).toFixed(1)}
            height={(H - pad.b - top).toFixed(1)}>
            <title>{`${d.day}: ${usd(d.cost, 4)} · ${d.calls} calls`}</title>
          </rect>
        );
      })}
      {byDay.map((d, i) =>
        i % 5 === 0 || i === byDay.length - 1 ? (
          <text key={d.day} x={(pad.l + i * bw + bw / 2).toFixed(1)} y={H - 8} textAnchor="middle">
            {d.day.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
