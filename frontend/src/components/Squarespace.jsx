import { useState } from "react";
import { MembersOverTime, StackedColumns, StatTiles, monthLabel } from "./Charts.jsx";

const SALES_SERIES = [
  { key: "memberships", label: "Memberships", color: "var(--viz-1)" },
  { key: "retail", label: "Retail", color: "var(--viz-2)" },
  { key: "events", label: "Events", color: "var(--viz-4)" },
];

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
          { label: "Current members", value: members.totals.members },
          { label: "Children added", value: members.totals.children, note: "Add Child, counted apart" },
          {
            label: "Joined this month",
            value: thisMonth?.joined ?? 0,
            note: `${thisMonth?.left ?? 0} left`,
          },
          { label: "Members all time", value: members.totals.allTimeMembers },
        ]}
      />

      <MembersOverTime
        timeline={members.timeline}
        subtitle="From Squarespace charges - a member counts until a renewal is a week overdue"
      />

      <section className="viz-card">
        <header className="viz-head">
          <div>
            <h3>Current members</h3>
            <p className="viz-sub">
              {members.current.length} paying accounts. Add Child is shown apart from the plan.
            </p>
          </div>
        </header>
        {members.current.length ? (
          <div className="viz-table-wrap members-table-wrap">
            <table className="viz-table">
              <thead>
                <tr>
                  {["Name", "Email", "Plan", "Add Child", "Member since", "Paying", "Last charged"].map((c) => (
                    <th key={c} scope="col">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.current.map((row) => (
                  <tr key={row.email}>
                    <td>{row.name || "-"}</td>
                    <td>{row.email}</td>
                    <td>{row.plans.join(", ") || "-"}</td>
                    <td>{row.addChild ? "Yes" : "-"}</td>
                    <td>{formatDate(row.memberSince)}</td>
                    <td>{paying(row)}</td>
                    <td>{formatDate(row.lastChargedAt)}</td>
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

const percent = (rate) => `${Math.round(rate * 100)}%`;

function ConversionTable({ rows }) {
  return (
    <table className="viz-table">
      <thead>
        <tr>
          {["", "Signed", "Joined", "Rate"].map((c) => (
            <th key={c} scope="col">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{row.signers}</td>
            <td>{row.joined}</td>
            <td>{row.signers ? percent(row.rate) : "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConversionPanel({ conversion }) {
  return (
    <>
      <StatTiles
        tiles={[
          {
            label: "Signed a waiver",
            value: conversion.signers,
            note: `${conversion.alreadyPaying} who had already paid are left out`,
          },
          { label: "Became members", value: conversion.joined },
          { label: "Conversion", display: percent(conversion.rate) },
          {
            label: "Typical time to join",
            display: conversion.medianDaysToJoin === null ? "-" : `${conversion.medianDaysToJoin} days`,
            note: "Median, from signing to first payment",
          },
        ]}
      />

      <div className="viz-two-up">
        <section className="viz-card">
          <header className="viz-head">
            <div>
              <h3>By month signed</h3>
              <p className="viz-sub">Recent months are still young - some will join yet.</p>
            </div>
          </header>
          <div className="viz-table-wrap">
            <ConversionTable
              rows={[...conversion.byMonth].reverse().map((m) => ({ ...m, label: monthLabel(m.month) }))}
            />
          </div>
        </section>

        <section className="viz-card">
          <header className="viz-head">
            <div>
              <h3>Did the follow-up email help?</h3>
              <p className="viz-sub">
                Only waivers signed since the follow-up launched can have had one, so the groups
                cover different periods.
              </p>
            </div>
          </header>
          <ConversionTable
            rows={[
              { label: "Sent the follow-up", ...conversion.followUp.sent },
              { label: "Not sent", ...conversion.followUp.notSent },
            ]}
          />
        </section>
      </div>
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
export default function SquarespaceSection({ data, loading, error, onRefresh }) {
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
        <h2 className="squarespace-subhead">Waivers to members</h2>
        <ConversionPanel conversion={data.conversion} />
        <h2 className="squarespace-subhead">Sales</h2>
        <SalesPanel sales={data.sales} />
      </>
    );
  }

  return (
    <section className="viz-dashboard squarespace-section" aria-label="Members and sales">
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
