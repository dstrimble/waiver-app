import { useEffect, useMemo, useRef, useState } from "react";

/*
 * Hand-rolled SVG charts - no charting dependency.
 *
 * Mark specs follow one house style: 2px lines with round caps, columns capped
 * at 24px with a 4px rounded data-end and a square foot on the baseline, >=8px
 * markers ringed in the surface colour, hairline recessive gridlines, and a 2px
 * surface gap separating touching marks. Colours come from the --viz-* tokens
 * in styles.css, which were validated against the chart surface; nothing here
 * hard-codes a hex.
 */

export const INTEREST_SERIES = [
  { key: "BJJ", color: "var(--viz-1)" },
  { key: "Kickboxing", color: "var(--viz-2)" },
  { key: "MMA", color: "var(--viz-3)" },
  { key: "Kids Classes", color: "var(--viz-4)" },
];

const AGE_RAMP = [
  "var(--viz-ord-1)",
  "var(--viz-ord-2)",
  "var(--viz-ord-3)",
  "var(--viz-ord-4)",
  "var(--viz-ord-5)",
];

const BAR_MAX = 24; // px - never fill the band; the leftover is air
const GAP = 2; // px - the surface gap that separates touching marks

/** Track the rendered width so charts draw at 1:1 and text stays crisp. */
function useMeasure() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    // jsdom has no ResizeObserver; fall back to the initial measurement.
    if (typeof ResizeObserver === "undefined") {
      setWidth(node.clientWidth || 640);
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** Round tick values whose top tick is always >= max, so no mark overflows. */
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const steps = Math.ceil(max / step);
  return Array.from({ length: steps + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

/** Thin x-axis labels to about six, so they never collide. */
function labelIndices(n, maxLabels = 6) {
  const set = new Set();
  if (n === 0) return set;
  const stride = n <= maxLabels ? 1 : Math.ceil(n / maxLabels);
  for (let i = 0; i < n; i += stride) set.add(i);
  set.add(n - 1);
  return set;
}

const formatNumber = (n) => Number(n).toLocaleString();

/** Column path: rounded at the data end, square where it meets the baseline. */
function columnPath(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  const radius = Math.min(r, w / 2, h);
  return [
    `M${x},${y + h}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

/** Horizontal bar path: rounded at the right-hand data end. */
function barPath(x, y, w, h, r = 4) {
  if (w <= 0) return "";
  const radius = Math.min(r, h / 2, w);
  return [
    `M${x},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h - radius}`,
    `Q${x + w},${y + h} ${x + w - radius},${y + h}`,
    `L${x},${y + h}`,
    "Z",
  ].join(" ");
}

function Tooltip({ x, y, width, children }) {
  // Flip to the left of the cursor when the box would run past the edge.
  const flip = x > width - 150;
  return (
    <div
      className="viz-tooltip"
      style={{ left: flip ? x - 12 : x + 12, top: y, transform: flip ? "translate(-100%, -50%)" : "translateY(-50%)" }}
      role="presentation"
    >
      {children}
    </div>
  );
}

function Legend({ series }) {
  return (
    <ul className="viz-legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className="viz-swatch" style={{ background: s.color }} aria-hidden="true" />
          {s.key}
        </li>
      ))}
    </ul>
  );
}

function ChartFrame({ title, subtitle, actions, table, children }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="viz-card">
      <header className="viz-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p className="viz-sub">{subtitle}</p> : null}
        </div>
        <div className="viz-actions">
          {actions}
          {table ? (
            <button type="button" className="viz-toggle" onClick={() => setShowTable((v) => !v)}>
              {showTable ? "Show chart" : "Show data"}
            </button>
          ) : null}
        </div>
      </header>
      {showTable && table ? <div className="viz-table-wrap">{table}</div> : children}
    </section>
  );
}

function SimpleTable({ columns, rows }) {
  return (
    <table className="viz-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ */
/* Waivers over time - single series, so no legend: the title names it. */
/* ------------------------------------------------------------------ */

export function SignupsOverTime({ points, granularity, onGranularity }) {
  const [ref, width] = useMeasure();
  const [hover, setHover] = useState(null);
  const height = 240;
  const pad = { top: 16, right: 20, bottom: 30, left: 44 };

  const max = Math.max(1, ...points.map((p) => p.count));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const xAt = (i) => (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yAt = (v) => plotH - (v / top) * plotH;

  // The final bucket is usually a partial week/month. Drawing it solid makes a
  // month that is three days old look like a collapse, so the closing segment
  // is dashed and the label says "to date".
  const partialTail = points.length > 1 && points[points.length - 1].partial;
  const solid = partialTail ? points.slice(0, -1) : points;
  const line = solid.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.count)}`).join(" ");
  const tail = partialTail
    ? `M${xAt(points.length - 2)},${yAt(points[points.length - 2].count)} L${xAt(points.length - 1)},${yAt(points[points.length - 1].count)}`
    : "";
  const area = points.length
    ? `${points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.count)}`).join(" ")} L${xAt(points.length - 1)},${plotH} L${xAt(0)},${plotH} Z`
    : "";
  const xLabels = labelIndices(points.length);

  function onMove(e) {
    if (!points.length || !plotW) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left - pad.left;
    const i = Math.max(0, Math.min(points.length - 1, Math.round((x / plotW) * (points.length - 1))));
    setHover(i);
  }

  const peak = points.reduce((best, p, i) => (p.count > (points[best]?.count ?? -1) ? i : best), 0);

  return (
    <ChartFrame
      title="Waivers signed over time"
      subtitle={`${formatNumber(points.reduce((n, p) => n + p.count, 0))} in this period`}
      actions={
        <div className="viz-segmented" role="group" aria-label="Bucket size">
          {["week", "month"].map((g) => (
            <button
              key={g}
              type="button"
              className={granularity === g ? "is-active" : ""}
              onClick={() => onGranularity(g)}
            >
              {g === "week" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
      }
      table={
        <SimpleTable
          columns={["Period", "Waivers"]}
          rows={points.map((p) => [p.label, formatNumber(p.count)])}
        />
      }
    >
      <div className="viz-plot" ref={ref}>
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Line chart of waivers signed per ${granularity}`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <g transform={`translate(${pad.left},${pad.top})`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={plotW} y1={yAt(t)} y2={yAt(t)} className="viz-gridline" />
                  <text x={-10} y={yAt(t)} className="viz-axis-label" textAnchor="end" dy="0.32em">
                    {formatNumber(t)}
                  </text>
                </g>
              ))}

              <path d={area} className="viz-area" style={{ fill: "var(--viz-1)" }} />
              <path d={line} className="viz-line" style={{ stroke: "var(--viz-1)" }} />
              {tail ? (
                <path d={tail} className="viz-line viz-line-partial" style={{ stroke: "var(--viz-1)" }} />
              ) : null}

              {/* Label the peak only - a number on every point goes unread. */}
              {points.length > 1 ? (
                <text
                  x={Math.min(plotW - 4, Math.max(4, xAt(peak)))}
                  y={yAt(points[peak].count) - 12}
                  className="viz-point-label"
                  textAnchor="middle"
                >
                  {formatNumber(points[peak].count)}
                </text>
              ) : null}

              {points.map((p, i) =>
                i === hover || points.length === 1 ? (
                  <circle
                    key={p.label}
                    cx={xAt(i)}
                    cy={yAt(p.count)}
                    r={5}
                    style={{ fill: "var(--viz-1)" }}
                    className="viz-marker"
                  />
                ) : null
              )}

              {hover !== null ? (
                <line
                  x1={xAt(hover)}
                  x2={xAt(hover)}
                  y1={0}
                  y2={plotH}
                  className="viz-crosshair"
                />
              ) : null}

              {points.map((p, i) =>
                xLabels.has(i) ? (
                  <text
                    key={`x-${p.label}`}
                    x={xAt(i)}
                    y={plotH + 20}
                    className="viz-axis-label"
                    textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                  >
                    {p.label}
                  </text>
                ) : null
              )}
            </g>
          </svg>
        ) : null}

        {hover !== null && points[hover] ? (
          <Tooltip x={pad.left + xAt(hover)} y={pad.top + yAt(points[hover].count)} width={width}>
            <strong>
              {points[hover].label}
              {points[hover].partial ? " (to date)" : ""}
            </strong>
            <span>{formatNumber(points[hover].count)} waivers</span>
          </Tooltip>
        ) : null}
      </div>
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Members over time - two lines on one axis: members, children added. */
/* ------------------------------------------------------------------ */

const MEMBER_SERIES = [
  { key: "members", label: "Members", color: "var(--viz-1)" },
  { key: "children", label: "Children added", color: "var(--viz-3)" },
];

export function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

export function MembersOverTime({ timeline, subtitle }) {
  const [ref, width] = useMeasure();
  const [hover, setHover] = useState(null);
  const height = 240;
  const pad = { top: 16, right: 28, bottom: 30, left: 44 };

  const points = timeline.map((t) => ({ ...t, label: monthLabel(t.month) }));
  const n = points.length;
  const max = Math.max(1, ...points.flatMap((p) => MEMBER_SERIES.map((s) => p[s.key])));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const xAt = (i) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => plotH - (v / top) * plotH;
  const pathFor = (key, from, to) =>
    points
      .slice(from, to)
      .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(from + i)},${yAt(p[key])}`)
      .join(" ");

  // Same convention as the waiver line: the month in progress is dashed.
  const partialTail = n > 1 && points[n - 1].partial;
  const xLabels = labelIndices(n);

  function onMove(e) {
    if (!n || !plotW) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left - pad.left;
    setHover(Math.max(0, Math.min(n - 1, Math.round((x / plotW) * (n - 1)))));
  }

  return (
    <ChartFrame
      title="Members over time"
      subtitle={subtitle}
      table={
        <SimpleTable
          columns={["Month", "Members", "Children added", "Joined", "Left"]}
          rows={points.map((p) => [
            `${p.label}${p.partial ? " (to date)" : ""}`,
            formatNumber(p.members),
            formatNumber(p.children),
            formatNumber(p.joined),
            formatNumber(p.left),
          ])}
        />
      }
    >
      <Legend series={MEMBER_SERIES.map((s) => ({ key: s.label, color: s.color }))} />
      <div className="viz-plot" ref={ref}>
        {width > 0 && n ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label="Line chart of members and children added per month"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <g transform={`translate(${pad.left},${pad.top})`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={plotW} y1={yAt(t)} y2={yAt(t)} className="viz-gridline" />
                  <text x={-10} y={yAt(t)} className="viz-axis-label" textAnchor="end" dy="0.32em">
                    {formatNumber(t)}
                  </text>
                </g>
              ))}

              {MEMBER_SERIES.map((s) => (
                <g key={s.key}>
                  <path
                    d={pathFor(s.key, 0, partialTail ? n - 1 : n)}
                    className="viz-line"
                    style={{ stroke: s.color }}
                  />
                  {partialTail ? (
                    <path
                      d={pathFor(s.key, n - 2, n)}
                      className="viz-line viz-line-partial"
                      style={{ stroke: s.color }}
                    />
                  ) : null}
                  {/* Label where each line ends - today's count is the one people want. */}
                  <text
                    x={xAt(n - 1) + 8}
                    y={yAt(points[n - 1][s.key])}
                    className="viz-point-label"
                    dy="0.32em"
                  >
                    {formatNumber(points[n - 1][s.key])}
                  </text>
                </g>
              ))}

              {hover !== null ? (
                <>
                  <line x1={xAt(hover)} x2={xAt(hover)} y1={0} y2={plotH} className="viz-crosshair" />
                  {MEMBER_SERIES.map((s) => (
                    <circle
                      key={s.key}
                      cx={xAt(hover)}
                      cy={yAt(points[hover][s.key])}
                      r={5}
                      style={{ fill: s.color }}
                      className="viz-marker"
                    />
                  ))}
                </>
              ) : null}

              {points.map((p, i) =>
                xLabels.has(i) ? (
                  <text
                    key={`x-${p.month}`}
                    x={xAt(i)}
                    y={plotH + 20}
                    className="viz-axis-label"
                    textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                  >
                    {p.label}
                  </text>
                ) : null
              )}
            </g>
          </svg>
        ) : null}

        {hover !== null && points[hover] ? (
          <Tooltip x={pad.left + xAt(hover)} y={pad.top + yAt(points[hover].members)} width={width}>
            <strong>
              {points[hover].label}
              {points[hover].partial ? " (to date)" : ""}
            </strong>
            {MEMBER_SERIES.map((s) => (
              <span key={s.key} style={{ display: "block" }}>
                <span className="viz-swatch" style={{ background: s.color }} aria-hidden="true" />{" "}
                {s.label}: {formatNumber(points[hover][s.key])}
              </span>
            ))}
            <span style={{ display: "block" }}>
              Joined {formatNumber(points[hover].joined)} · Left {formatNumber(points[hover].left)}
            </span>
          </Tooltip>
        ) : null}
      </div>
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------- */
/* Interest mix - stacked columns, 4 series, legend + per-segment hover. */
/* ------------------------------------------------------------------- */

export function InterestMix({ buckets }) {
  return (
    <StackedColumns
      title="Interests over time"
      subtitle="Counts selections, not people - one waiver can tick more than one class"
      series={INTEREST_SERIES.map((s) => ({ ...s, label: s.key }))}
      buckets={buckets}
    />
  );
}

/**
 * Stacked columns over time. `series` is [{ key, label, color }] and each
 * bucket is { label, counts: { [key]: value } }. `format` renders values in
 * the table and tooltip, `tickFormat` the (shorter) axis labels.
 */
export function StackedColumns({
  title,
  subtitle,
  series,
  buckets,
  actions,
  format = formatNumber,
  tickFormat = format,
}) {
  const [ref, width] = useMeasure();
  const [hover, setHover] = useState(null);
  const height = 260;
  const pad = { top: 16, right: 20, bottom: 34, left: 44 };

  const totals = buckets.map((b) => series.reduce((n, s) => n + (b.counts[s.key] || 0), 0));
  const max = Math.max(1, ...totals);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const band = buckets.length ? plotW / buckets.length : 0;
  const barW = Math.min(BAR_MAX, Math.max(4, band - 10));

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      actions={actions}
      table={
        <SimpleTable
          columns={["Period", ...series.map((s) => s.label), "Total"]}
          rows={buckets.map((b, i) => [
            b.label,
            ...series.map((s) => format(b.counts[s.key] || 0)),
            format(totals[i]),
          ])}
        />
      }
    >
      <Legend series={series.map((s) => ({ key: s.label, color: s.color }))} />
      <div className="viz-plot" ref={ref}>
        {width > 0 ? (
          <svg width={width} height={height} role="img" aria-label={title}>
            <g transform={`translate(${pad.left},${pad.top})`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={plotW} y1={plotH - (t / top) * plotH} y2={plotH - (t / top) * plotH} className="viz-gridline" />
                  <text x={-10} y={plotH - (t / top) * plotH} className="viz-axis-label" textAnchor="end" dy="0.32em">
                    {tickFormat(t)}
                  </text>
                </g>
              ))}

              {buckets.map((bucket, bi) => {
                const x = bi * band + (band - barW) / 2;
                let cursor = plotH;
                // Draw bottom-up so the last drawn segment is the stack's cap.
                const drawn = series.map((s) => {
                  const value = bucket.counts[s.key] || 0;
                  if (!value) return null;
                  const full = (value / top) * plotH;
                  const h = Math.max(1, full - GAP); // the 2px surface gap
                  const y = cursor - full;
                  cursor -= full;
                  return { s, value, y, h };
                }).filter(Boolean);

                return drawn.map((seg, idx) => (
                  <path
                    key={`${bucket.label}-${seg.s.key}`}
                    d={
                      idx === drawn.length - 1
                        ? columnPath(x, seg.y, barW, seg.h)
                        : `M${x},${seg.y} h${barW} v${seg.h} h${-barW} Z`
                    }
                    style={{ fill: seg.s.color }}
                    className={hover && hover.label !== bucket.label ? "viz-dim" : ""}
                    onMouseEnter={() =>
                      setHover({
                        label: bucket.label,
                        key: seg.s.label,
                        value: seg.value,
                        color: seg.s.color,
                        x: pad.left + x + barW / 2,
                        y: pad.top + seg.y + seg.h / 2,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                ));
              })}

              {buckets.map((b, i) =>
                labelIndices(buckets.length).has(i) ? (
                  <text
                    key={`lab-${b.label}`}
                    x={i * band + band / 2}
                    y={plotH + 20}
                    className="viz-axis-label"
                    textAnchor="middle"
                  >
                    {b.label}
                  </text>
                ) : null
              )}
            </g>
          </svg>
        ) : null}

        {hover ? (
          <Tooltip x={hover.x} y={hover.y} width={width}>
            <strong>{hover.label}</strong>
            <span>
              <span className="viz-swatch" style={{ background: hover.color }} aria-hidden="true" />
              {hover.key}: {format(hover.value)}
            </span>
          </Tooltip>
        ) : null}
      </div>
    </ChartFrame>
  );
}

/* ----------------------------------------------------------- */
/* Horizontal bars - nominal categories, so one hue, not a ramp. */
/* ----------------------------------------------------------- */

export function RankedBars({ title, subtitle, rows, valueLabel = "Waivers" }) {
  const [ref, width] = useMeasure();
  const [hover, setHover] = useState(null);
  const rowH = 30;
  const pad = { top: 8, right: 52, bottom: 8, left: 140 };
  const height = pad.top + pad.bottom + rows.length * rowH;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const plotW = Math.max(0, width - pad.left - pad.right);
  const total = rows.reduce((n, r) => n + r.count, 0);

  // "Not specified" and the folded tail are not marketing channels, so they sit
  // in neutral grey rather than competing with the real ones for attention.
  const isResidual = (label) => label === "Not specified" || label.startsWith("Other (");

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      table={<SimpleTable columns={["Label", valueLabel]} rows={rows.map((r) => [r.label, formatNumber(r.count)])} />}
    >
      <div className="viz-plot" ref={ref}>
        {width > 0 && rows.length ? (
          <svg width={width} height={height} role="img" aria-label={title}>
            <g transform={`translate(${pad.left},${pad.top})`}>
              {rows.map((row, i) => {
                const barH = Math.min(BAR_MAX, rowH - 8);
                const y = i * rowH + (rowH - barH) / 2;
                const w = (row.count / max) * plotW;
                return (
                  <g
                    key={row.label}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  >
                    {/* Full-width hit target: the bar itself can be a sliver. */}
                    <rect x={-pad.left} y={i * rowH} width={width} height={rowH} fill="transparent" />
                    <text x={-12} y={y + barH / 2} className="viz-cat-label" textAnchor="end" dy="0.32em">
                      {row.label.length > 20 ? `${row.label.slice(0, 19)}…` : row.label}
                    </text>
                    <path
                      d={barPath(0, y, Math.max(2, w), barH)}
                      style={{ fill: isResidual(row.label) ? "var(--viz-neutral)" : "var(--viz-1)" }}
                      className={hover !== null && hover !== i ? "viz-dim" : ""}
                    />
                    <text x={Math.max(2, w) + 10} y={y + barH / 2} className="viz-point-label" dy="0.32em">
                      {formatNumber(row.count)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        ) : (
          <p className="empty-state">Nothing recorded yet.</p>
        )}

        {hover !== null && rows[hover] ? (
          <Tooltip
            x={pad.left + (rows[hover].count / max) * plotW}
            y={pad.top + hover * rowH + rowH / 2}
            width={width}
          >
            <strong>{rows[hover].label}</strong>
            <span>
              {formatNumber(rows[hover].count)} · {Math.round((rows[hover].count / total) * 100)}%
            </span>
          </Tooltip>
        ) : null}
      </div>
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Columns for an ordered scale (age) or a flat one (weekday).          */
/* ------------------------------------------------------------------ */

export function CategoryColumns({ title, subtitle, rows, ordered = false }) {
  const [ref, width] = useMeasure();
  const [hover, setHover] = useState(null);
  const height = 200;
  const pad = { top: 20, right: 12, bottom: 30, left: 40 };
  const max = Math.max(1, ...rows.map((r) => r.count));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const band = rows.length ? plotW / rows.length : 0;
  const barW = Math.min(BAR_MAX, Math.max(6, band - GAP * 3));

  // An ordered scale earns the ordinal ramp; a flat one gets a single hue,
  // because shading nominal bars by size just re-encodes their length.
  const colorAt = (i) =>
    ordered
      ? rows[i].label === "Unknown"
        ? "var(--viz-neutral)"
        : AGE_RAMP[Math.min(i, AGE_RAMP.length - 1)]
      : "var(--viz-1)";

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      table={<SimpleTable columns={["Group", "Waivers"]} rows={rows.map((r) => [r.label, formatNumber(r.count)])} />}
    >
      <div className="viz-plot" ref={ref}>
        {width > 0 ? (
          <svg width={width} height={height} role="img" aria-label={title}>
            <g transform={`translate(${pad.left},${pad.top})`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={plotW} y1={plotH - (t / top) * plotH} y2={plotH - (t / top) * plotH} className="viz-gridline" />
                  <text x={-10} y={plotH - (t / top) * plotH} className="viz-axis-label" textAnchor="end" dy="0.32em">
                    {formatNumber(t)}
                  </text>
                </g>
              ))}
              {rows.map((row, i) => {
                const h = (row.count / top) * plotH;
                const x = i * band + (band - barW) / 2;
                return (
                  <g key={row.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                    <rect x={i * band} y={0} width={band} height={plotH} fill="transparent" />
                    <path
                      d={columnPath(x, plotH - h, barW, h)}
                      style={{ fill: colorAt(i) }}
                      className={hover !== null && hover !== i ? "viz-dim" : ""}
                    />
                    <text
                      x={i * band + band / 2}
                      y={Math.max(-6, plotH - h - 8)}
                      className="viz-point-label"
                      textAnchor="middle"
                    >
                      {row.count ? formatNumber(row.count) : ""}
                    </text>
                    <text x={i * band + band / 2} y={plotH + 20} className="viz-axis-label" textAnchor="middle">
                      {row.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        ) : null}

        {hover !== null && rows[hover] ? (
          <Tooltip
            x={pad.left + hover * band + band / 2}
            y={pad.top + plotH - (rows[hover].count / top) * plotH}
            width={width}
          >
            <strong>{rows[hover].label}</strong>
            <span>
              {formatNumber(rows[hover].count)} ·{" "}
              {Math.round((rows[hover].count / Math.max(1, rows.reduce((n, r) => n + r.count, 0))) * 100)}%
            </span>
          </Tooltip>
        ) : null}
      </div>
    </ChartFrame>
  );
}

export function StatTiles({ tiles }) {
  return (
    <div className="viz-tiles">
      {tiles.map((tile) => (
        <div className="viz-tile" key={tile.label}>
          <p className="viz-tile-value">{tile.display ?? formatNumber(tile.value)}</p>
          <p className="viz-tile-label">{tile.label}</p>
          {tile.note ? <p className="viz-tile-note">{tile.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------- data shaping ---------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monday-anchored week key, so buckets line up with how a gym reads a week. */
function weekStart(dayString) {
  const d = new Date(`${dayString}T00:00:00`);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

function todayKey(granularity) {
  const now = new Date();
  const iso = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return bucketKey(iso, granularity).key;
}

function bucketKey(dayString, granularity) {
  if (granularity === "month") {
    const [y, m] = dayString.split("-");
    return { key: `${y}-${m}`, label: `${MONTHS[Number(m) - 1]} ${y.slice(2)}` };
  }
  const start = weekStart(dayString);
  return {
    key: start.toISOString().slice(0, 10),
    label: `${MONTHS[start.getMonth()]} ${start.getDate()}`,
  };
}

function withinRange(dayString, days) {
  if (!days) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return new Date(`${dayString}T00:00:00`) >= cutoff;
}

/** Roll daily counts into week or month buckets, zero-filling empty periods. */
export function bucketDaily(daily, granularity, days) {
  const rows = daily.filter((r) => withinRange(r.day, days));
  const byKey = new Map();
  for (const row of rows) {
    const { key, label } = bucketKey(row.day, granularity);
    const current = byKey.get(key) || { key, label, count: 0 };
    current.count += row.count;
    byKey.set(key, current);
  }
  const current = todayKey(granularity);
  return [...byKey.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((b) => ({ ...b, partial: b.key === current }));
}

export function bucketByInterest(dailyByInterest, granularity, days) {
  const rows = dailyByInterest.filter((r) => withinRange(r.day, days));
  const byKey = new Map();
  for (const row of rows) {
    const { key, label } = bucketKey(row.day, granularity);
    const current = byKey.get(key) || { key, label, counts: {} };
    current.counts[row.interest] = (current.counts[row.interest] || 0) + row.count;
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Keep the top N labels and fold the tail into one "Other" row. */
export function foldTail(rows, limit = 7) {
  if (rows.length <= limit) return rows;
  const head = rows.slice(0, limit);
  const tail = rows.slice(limit).reduce((n, r) => n + r.count, 0);
  return tail ? [...head, { label: `Other (${rows.length - limit})`, count: tail }] : head;
}

export function useChartRange(defaultDays = 365) {
  return useMemo(() => defaultDays, [defaultDays]);
}
