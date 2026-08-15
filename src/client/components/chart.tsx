// Per-page reading-time bar chart. One ordinal series (page order), one data
// hue; bars are anchored to the baseline with rounded data-ends, grid is
// recessive, and identity never depends on color alone (every bar carries its
// numbers as a native tooltip + accessible title).

import { useMemo } from "react";
import { fmtDuration, type PageStat } from "../api";

const BAR_W = 18;
const GAP = 2;
const H = 180;
const PAD_TOP = 18;
const PAD_BOTTOM = 20;
const AXIS_W = 40;

/** Round up to a friendly axis maximum: 1/2/5 × 10^k. */
function niceMax(v: number): number {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

export function PageBarChart({ perPage, pageCount }: { perPage: PageStat[]; pageCount: number }) {
  const pages = useMemo(() => {
    const byPage = new Map(perPage.map((p) => [p.page, p]));
    const n = Math.max(pageCount, perPage.length ? Math.max(...perPage.map((p) => p.page)) : 0);
    return Array.from({ length: n }, (_, i) => byPage.get(i + 1) ?? { page: i + 1, avg_seconds: 0, total_seconds: 0, views: 0 });
  }, [perPage, pageCount]);

  if (!pages.length) return null;

  const max = niceMax(Math.max(...pages.map((p) => p.avg_seconds), 1));
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const width = AXIS_W + pages.length * (BAR_W + GAP);
  const peak = pages.reduce((a, b) => (b.avg_seconds > a.avg_seconds ? b : a), pages[0]);
  // Label x-axis ticks sparsely so they never collide: aim for ≤ 12 labels.
  const tickEvery = Math.max(1, Math.ceil(pages.length / 12));

  const y = (v: number) => PAD_TOP + plotH - (v / max) * plotH;

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`Average reading time per page across ${pages.length} pages`}
        className="block"
      >
        {/* Recessive grid: hairlines at 0 / half / max. */}
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={AXIS_W} x2={width} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={AXIS_W - 6} y={y(v) + 3.5} textAnchor="end" fontSize="11" fill="var(--muted)" className="data">
              {fmtDuration(v)}
            </text>
          </g>
        ))}
        {pages.map((p, i) => {
          const x = AXIS_W + i * (BAR_W + GAP);
          const h = Math.max(p.avg_seconds > 0 ? 2 : 0, (p.avg_seconds / max) * plotH);
          return (
            <g key={p.page}>
              {p.avg_seconds > 0 ? (
                // Rounded data-end at the top, square against the baseline: the
                // clip keeps the bottom corners sharp while the rect's own
                // radius rounds the top.
                <>
                  <clipPath id={`clip-${p.page}`}>
                    <rect x={x} y={y(p.avg_seconds)} width={BAR_W} height={h} />
                  </clipPath>
                  <rect
                    x={x}
                    y={y(p.avg_seconds)}
                    width={BAR_W}
                    height={h + 4}
                    rx={4}
                    fill="var(--chart)"
                    clipPath={`url(#clip-${p.page})`}
                    className="transition-opacity hover:opacity-80"
                  >
                    <title>{`Page ${p.page} — avg ${fmtDuration(p.avg_seconds)} across ${p.views} ${p.views === 1 ? "view" : "views"}`}</title>
                  </rect>
                </>
              ) : (
                <rect x={x} y={PAD_TOP + plotH - 1} width={BAR_W} height={1} fill="var(--faint)" opacity={0.5}>
                  <title>{`Page ${p.page} — not read yet`}</title>
                </rect>
              )}
              {/* Direct label on the peak bar only — selective, never every point. */}
              {p.page === peak.page && p.avg_seconds > 0 ? (
                <text
                  x={x + BAR_W / 2}
                  y={y(p.avg_seconds) - 5}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--foreground)"
                  className="data"
                >
                  {fmtDuration(p.avg_seconds)}
                </text>
              ) : null}
              {(i + 1) % tickEvery === 0 || pages.length <= 12 ? (
                <text
                  x={x + BAR_W / 2}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--muted)"
                  className="data"
                >
                  {p.page}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
