import { StatTiles, monthLabel } from "./Charts.jsx";

const percent = (rate) => `${Math.round(rate * 100)}%`;

const CONVERSION_COLUMNS = ["", "Signed", "Joined", "Rate"];

function ConversionTable({ rows }) {
  return (
    <table className="viz-table" role="table">
      <thead role="rowgroup">
        <tr role="row">
          {CONVERSION_COLUMNS.map((c) => (
            <th key={c} scope="col" role="columnheader">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => (
          <tr key={row.label} role="row">
            {[row.label, row.signers, row.joined, row.signers ? percent(row.rate) : "-"].map(
              (value, index) => (
                <td key={CONVERSION_COLUMNS[index]} role="cell" data-label={CONVERSION_COLUMNS[index]}>
                  {value}
                </td>
              )
            )}
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

/**
 * Waiver signers who went on to pay, matched to Squarespace by email. Lives on
 * the waiver page: it is a question about waivers, answered with membership
 * charges, and it never shows who the members are.
 */
export default function ConversionSection({ data, loading, error, onRefresh }) {
  let body = null;
  if (!data) {
    if (loading) body = <p className="empty-state">Checking waivers against Squarespace...</p>;
  } else if (!data.configured) {
    body = (
      <p className="empty-state">
        Squarespace is not connected. Set <code>SQUARESPACE_API_KEY</code> on the backend to see how
        many waiver signers became members.
      </p>
    );
  } else {
    body = <ConversionPanel conversion={data.conversion} />;
  }

  return (
    <section className="viz-dashboard squarespace-section" aria-label="Waivers to members">
      <div className="squarespace-head">
        <h2>Waivers to members</h2>
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
