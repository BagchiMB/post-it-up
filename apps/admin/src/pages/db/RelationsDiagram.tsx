import type { DbRelation } from '@postitup/shared';
import { Link } from 'react-router';

import { tablePath } from './dbApi';

const BW = 150;
const BH = 30;
const GX = 70;
const GY = 46;
const PAD = 16;

/** Inline SVG of every table (grid) with a curve per relation; dashed = inferred. */
export function RelationsDiagram({
  tables,
  relations,
  current,
}: {
  tables: string[];
  relations: DbRelation[];
  current?: string;
}) {
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(tables.length))));
  const rows = Math.ceil(tables.length / cols);
  const pos = new Map(
    tables.map((t, i) => [
      t,
      { x: PAD + (i % cols) * (BW + GX), y: PAD + Math.floor(i / cols) * (BH + GY) },
    ]),
  );
  const W = PAD * 2 + cols * BW + (cols - 1) * GX;
  const H = PAD * 2 + rows * BH + (rows - 1) * GY;

  const edge = (r: DbRelation, i: number) => {
    const a = pos.get(r.from);
    const b = pos.get(r.to);
    if (!a || !b) return null;
    const touches = !current || r.from === current || r.to === current;
    let d: string;
    if (r.from === r.to) {
      d = `M ${a.x + BW} ${a.y + 8} c 28 -18 28 32 0 14`;
    } else {
      const right = b.x >= a.x;
      const sx = right ? a.x + BW : a.x;
      const ex = b.x > a.x + BW / 2 ? b.x : b.x < a.x - BW / 2 ? b.x + BW : b.x + BW / 2;
      const sy = a.y + BH / 2;
      const ey = Math.abs(b.x - a.x) < BW / 2 ? (b.y > a.y ? b.y : b.y + BH) : b.y + BH / 2;
      const dx = Math.max(40, Math.abs(ex - sx) / 2) * (right ? 1 : -1);
      d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${ex - dx / 2} ${ey}, ${ex} ${ey}`;
    }
    return (
      <path
        key={i}
        className={`rel${r.inferred ? ' inferred' : ''}`}
        d={d}
        markerEnd="url(#arrow)"
        style={{ opacity: touches ? 0.85 : 0.18 }}>
        <title>{`${r.from}.${r.fromColumn} → ${r.to}.${r.toColumn}${r.inferred ? ' (inferred)' : ''}`}</title>
      </path>
    );
  };

  return (
    <svg
      className="diagram"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Diagram of ${tables.length} tables and ${relations.length} relations`}>
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
        </marker>
      </defs>
      {relations.map(edge)}
      {tables.map((t) => {
        const p = pos.get(t)!;
        return (
          <Link key={t} to={tablePath(t, { tab: 'relations' })} aria-label={`Table ${t}`}>
            <rect
              className={`tbl${t === current ? ' current' : ''}`}
              x={p.x}
              y={p.y}
              width={BW}
              height={BH}
              rx={8}
            />
            <text x={p.x + BW / 2} y={p.y + BH / 2 + 4} textAnchor="middle">
              {t.length > 20 ? `${t.slice(0, 19)}…` : t}
            </text>
          </Link>
        );
      })}
    </svg>
  );
}
