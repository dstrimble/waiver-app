import { useState } from "react";
import { MembersOverTime, StackedColumns, StatTiles, monthLabel } from "./Charts.jsx";

const SALES_SERIES = [
  { key: "memberships", label: "Memberships", color: "var(--viz-1)" },
  { key: "retail", label: "Retail", color: "var(--viz-2)" },
  { key: "events", label: "Events", color: "var(--viz-4)" },
];

// Each cell carries its column name, which the phone card layout shows beside
// the value once the header row is hidden.
const MEMBER_COLUMNS = ["Name", "Email", "Plan", "Add Child", "Member since", "Paying", "Last charged"];

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

const dollars = (n) => `$${Math.round(n).toLocaleString()}`;
const cents = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const compactDollars = (n) => (n >= 1000 ? `$${Math.round(n / 100) / 10}k` : `$${n}`);

function paying(row) {
  const parts = [];
  if (row.monthlyAmount || !row.annualAmount) parts.push(`${cents(row.monthlyAmount)}/mo`);
  if (row.annualAmount) parts.push(`${cents(row.annualAmount)}/yr`);
  return parts.join(" + ");
}

function share(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)}% of sales` : "";
}

function MembersPanel({ members }) {
  const thisMonth = members.timeline[members.timeline.length - 1];
  return (
    <>
      <StatTiles
        tiles={[
          {
            label: "Current members",
            value: members.totals.members,
            note: members.totals.coaches
              ? `${members.totals.coaches} coach${members.totals.coaches === 1 ? "" : "es"} on the coach discount not counted`
              : undefined,
          },
          { label: "Children added", value: members.totals.children, note: "Add Child, counted apart" },
          {
            label: "Joined this month",
            value: thisMonth?.joined ?? 0,
            note: `${thisMonth?.left ?? 0} left`,
          },
          {
            label: "Monthly membership revenue",
            display: dollars(members.totals.monthlyRevenue),
            note: "What current members pay a month; annual plans spread over 12",
          },
        ]}
      />

      <MembersOverTime
        timeline={members.timeline}
        subtitle="From Squarespace charges - a member counts until a renewal is a week overdue. Coaches are left out."
      />

      <section className="viz-card">
        <header className="viz-head">
          <div>
            <h3>Current members</h3>
            <p className="viz-sub">
              {members.current.length} paying accounts, not counting coaches. Add Child is shown
              apart from the plan.
            </p>
          </div>
        </header>
        {members.current.length ? (
          <div className="viz-table-wrap members-table-wrap">
            <table className="viz-table" role="table">
              <thead role="rowgroup">
                <tr role="row">
                  {MEMBER_COLUMNS.map((c) => (
                    <th key={c} scope="col" role="columnheader">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {members.current.map((row) => (
                  <tr key={row.email} role="row">
                    {[
                      row.name || "-",
                      row.email,
                      row.plans.join(", ") || "-",
                      row.addChild ? "Yes" : "-",
                      formatDate(row.memberSince),
                      paying(row),
                      formatDate(row.lastChargedAt),
                    ].map((value, index) => (
                      <td key={MEMBER_COLUMNS[index]} role="cell" data-label={MEMBER_COLUMNS[index]}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">No current members found.</p>
        )}
      </section>
    </>
  );
}

function SalesPanel({ sales }) {
  const [range, setRange] = useState(12);
  const months = range ? sales.months.slice(-range) : sales.months;
  const buckets = months.map((m) => ({
    label: `${monthLabel(m.month)}${m.partial ? " (to date)" : ""}`,
    counts: m,
  }));
  const year = sales.totals.last12;

  return (
    <>
      <StatTiles
        tiles={[
          { label: "Sales this month", display: dollars(sales.totals.thisMonth), note: "To date" },
          { label: "Last 12 months", display: dollars(year.total) },
          { label: "Memberships, 12 months", display: dollars(year.memberships), note: share(year.memberships, year.total) },
          { label: "Retail, 12 months", display: dollars(year.retail), note: share(year.retail, year.total) },
          { label: "Events, 12 months", display: dollars(year.events), note: share(year.events, year.total) },
        ]}
      />

      <StackedColumns
        title="Sales by month"
        subtitle="After discounts, before tax and shipping. Refunded orders are left out."
        series={SALES_SERIES}
        buckets={buckets}
        format={cents}
        tickFormat={compactDollars}
        actions={
          <div className="viz-segmented" role="group" aria-label="Sales range">
            {[
              { months: 12, label: "12 months" },
              { months: 0, label: "All time" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                className={range === option.months ? "is-active" : ""}
                onClick={() => setRange(option.months)}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />
    </>
  );
}

/**
 * Members and sales from Squarespace orders. Membership is inferred from
 * charges - Squarespace has no "is a member" flag - so the copy says so rather
 * than presenting the numbers as exact.
 */
export default function MembersSection({ data, loading, error, onRefresh }) {
  let body = null;
  if (!data) {
    if (loading) body = <p className="empty-state">Loading members and sales from Squarespace...</p>;
  } else if (!data.configured) {
    body = (
      <p className="empty-state">
        Squarespace is not connected. Set <code>SQUARESPACE_API_KEY</code> on the backend to see
        members and sales here.
      </p>
    );
  } else {
    body = (
      <>
        <MembersPanel members={data.members} />
        <h2 className="squarespace-subhead">Sales</h2>
        <SalesPanel sales={data.sales} />
      </>
    );
  }

  return (
    <section className="viz-dashboard" aria-label="Members and sales">
      <div className="squarespace-head">
        <h2>Members</h2>
        {data?.fetchedAt ? (
          <span className="viz-sub">From Squarespace, {new Date(data.fetchedAt).toLocaleString()}</span>
        ) : null}
        {data?.configured !== false ? (
          <button type="button" className="viz-toggle" onClick={onRefresh} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {body}
    </section>
  );
}
