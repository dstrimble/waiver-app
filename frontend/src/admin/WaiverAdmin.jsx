import { useEffect, useMemo, useState } from "react";
import {
  adminArchiveWaiver,
  adminGetConversion,
  adminGetStats,
  adminGetWaivers,
  adminSendFollowUp,
} from "../api.js";
import {
  CategoryColumns,
  InterestMix,
  RankedBars,
  SignupsOverTime,
  StatTiles,
  bucketByInterest,
  bucketDaily,
  foldTail,
} from "../components/Charts.jsx";
import ConversionSection from "../components/Conversion.jsx";

function toDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDisplayDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

/**
 * Waiver page: waiver charts, how many signers became members, and the waiver
 * list with its follow-up and archive actions.
 */
export default function WaiverAdmin({ auth }) {
  const [waiversLoading, setWaiversLoading] = useState(false);
  const [waiversError, setWaiversError] = useState("");
  const [waivers, setWaivers] = useState([]);
  const [selectedWaiver, setSelectedWaiver] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState("");
  const [granularity, setGranularity] = useState("month");
  const [rangeDays, setRangeDays] = useState(365);
  const [rowBusy, setRowBusy] = useState("");
  const [rowError, setRowError] = useState("");
  const [rowNotice, setRowNotice] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [conversion, setConversion] = useState(null);
  const [conversionLoading, setConversionLoading] = useState(false);
  const [conversionError, setConversionError] = useState("");

  const today = useMemo(() => new Date(), []);
  const defaultEnd = toDateOnly(today);
  const defaultStart = toDateOnly(new Date(today.getTime() - 29 * 86400000));
  const [dateRange, setDateRange] = useState({ start: defaultStart, end: defaultEnd });

  useEffect(() => {
    loadWaivers(dateRange.start, dateRange.end);
    loadStats();
    // Not awaited anywhere: the first Squarespace pull takes several seconds,
    // and the rest of the page should not wait on it.
    loadConversion();
  }, [auth]);

  async function loadWaivers(start, end, includeArchived = showArchived) {
    setWaiversLoading(true);
    setWaiversError("");
    try {
      const rows = await adminGetWaivers(auth, { start, end, includeArchived });
      setWaivers(rows);
      setSelectedWaiver((current) => {
        if (!current) return rows[0] || null;
        return rows.find((row) => row.id === current.id) || rows[0] || null;
      });
    } catch (err) {
      setWaiversError(err.message || "Failed to load waivers.");
    } finally {
      setWaiversLoading(false);
    }
  }

  async function loadStats() {
    setStatsError("");
    try {
      setStats(await adminGetStats(auth));
    } catch (err) {
      setStatsError(err.message || "Failed to load stats.");
    }
  }

  async function loadConversion(refresh = false) {
    setConversionLoading(true);
    setConversionError("");
    try {
      setConversion(await adminGetConversion(auth, { refresh }));
    } catch (err) {
      setConversionError(err.message || "Failed to load Squarespace data.");
    } finally {
      setConversionLoading(false);
    }
  }

  async function runDateFilter(e) {
    e.preventDefault();
    await loadWaivers(dateRange.start, dateRange.end);
  }

  // Sending by hand claims the waiver the same way the weekly sweep does, so
  // the automatic follow-up is suppressed and nobody receives two.
  async function sendFollowUpNow(row) {
    setRowBusy(`followup-${row.id}`);
    setRowError("");
    setRowNotice(null);
    try {
      const result = await adminSendFollowUp(auth, row.id);
      setRowNotice({
        text: `Follow-up sent to ${result.sentTo}. The automatic one is now cancelled.`,
      });
      await Promise.all([loadWaivers(dateRange.start, dateRange.end), loadStats()]);
    } catch (err) {
      setRowError(err.message || "Could not send the follow-up.");
    } finally {
      setRowBusy("");
    }
  }

  // Archiving is reversible, so it needs no confirmation dialog - it offers an
  // undo instead, and the record itself is never destroyed.
  async function setArchived(row, archived) {
    setRowBusy(`archive-${row.id}`);
    setRowError("");
    setRowNotice(null);
    try {
      await adminArchiveWaiver(auth, row.id, archived);
      setRowNotice({
        text: archived
          ? `Archived ${row.name}. The signed waiver is kept, just hidden.`
          : `Restored ${row.name}.`,
        undo: { row, archived: !archived },
      });
      if (archived && !showArchived) setSelectedWaiver(null);
      await Promise.all([loadWaivers(dateRange.start, dateRange.end), loadStats()]);
    } catch (err) {
      setRowError(err.message || "Could not update the waiver.");
    } finally {
      setRowBusy("");
    }
  }

  async function toggleShowArchived() {
    const next = !showArchived;
    setShowArchived(next);
    setRowNotice(null);
    await loadWaivers(dateRange.start, dateRange.end, next);
  }

  const timeline = useMemo(
    () => (stats ? bucketDaily(stats.daily, granularity, rangeDays) : []),
    [stats, granularity, rangeDays]
  );
  const interestBuckets = useMemo(
    () => (stats ? bucketByInterest(stats.dailyByInterest, granularity, rangeDays) : []),
    [stats, granularity, rangeDays]
  );
  const heardAboutRows = useMemo(() => (stats ? foldTail(stats.heardAbout) : []), [stats]);

  return (
    <>
      {statsError ? <p className="error">{statsError}</p> : null}

      {stats ? (
        <div className="viz-dashboard">
          <StatTiles
            tiles={[
              { label: "Waivers all time", value: stats.totals.allTime },
              { label: "Last 30 days", value: stats.totals.last30 },
              { label: "Last 7 days", value: stats.totals.last7 },
              {
                label: "Follow-ups sent",
                value: stats.totals.followUpsSent,
                note: `${stats.totals.followUpsPending} awaiting their week`,
              },
            ]}
          />

          <div className="viz-range" role="group" aria-label="Chart range">
            <div className="viz-segmented">
              {[
                { days: 90, label: "90 days" },
                { days: 365, label: "12 months" },
                { days: 0, label: "All time" },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={rangeDays === option.days ? "is-active" : ""}
                  onClick={() => setRangeDays(option.days)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <SignupsOverTime points={timeline} granularity={granularity} onGranularity={setGranularity} />

          <InterestMix buckets={interestBuckets} />

          <div className="viz-two-up">
            <RankedBars
              title="How they heard about us"
              subtitle="Typed by hand on the form, grouped ignoring case"
              rows={heardAboutRows}
            />
            <CategoryColumns
              title="Age when signing"
              subtitle="From date of birth on the waiver"
              rows={stats.ageBands.map((b) => ({ label: b.band, count: b.count }))}
              ordered
            />
          </div>

          <CategoryColumns
            title="Which day people sign"
            subtitle={`All waivers, ${stats.timezone.replace("_", " ")}`}
            rows={stats.weekday}
          />
        </div>
      ) : null}

      <ConversionSection
        data={conversion}
        loading={conversionLoading}
        error={conversionError}
        onRefresh={() => loadConversion(true)}
      />

      <form className="admin-filters" onSubmit={runDateFilter}>
        <label>
          Start Date
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange((current) => ({ ...current, start: e.target.value }))}
            required
          />
        </label>
        <label>
          End Date
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange((current) => ({ ...current, end: e.target.value }))}
            required
          />
        </label>
        <button type="submit" className="submit admin-refresh" disabled={waiversLoading}>
          {waiversLoading ? "Loading..." : "Load Waivers"}
        </button>
        <label className="archived-toggle">
          <input type="checkbox" checked={showArchived} onChange={toggleShowArchived} />
          Show archived
        </label>
      </form>

      {waiversError ? <p className="error">{waiversError}</p> : null}

      <div className="admin-grid">
        <div className="waiver-list" role="list">
          {waivers.length === 0 ? (
            <p className="empty-state">No signed waivers found for this period.</p>
          ) : (
            waivers.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`waiver-row ${selectedWaiver?.id === row.id ? "is-selected" : ""} ${
                  row.archived_at ? "is-archived" : ""
                }`}
                onClick={() => setSelectedWaiver(row)}
              >
                <strong>
                  {row.name}
                  {row.archived_at ? <span className="badge-archived">Archived</span> : null}
                </strong>
                <span>{row.email}</span>
                <span>{toDisplayDate(row.submitted_at)}</span>
              </button>
            ))
          )}
        </div>

        <div className="waiver-detail">
          {selectedWaiver ? (
            <>
              <h3>
                {selectedWaiver.name}
                {selectedWaiver.archived_at ? <span className="badge-archived">Archived</span> : null}
              </h3>
              <p>
                <strong>Submitted:</strong> {toDisplayDate(selectedWaiver.submitted_at)}
              </p>
              <p>
                <strong>Email:</strong> {selectedWaiver.email || "-"}
              </p>
              <p>
                <strong>Interests:</strong>{" "}
                {Array.isArray(selectedWaiver.interests) && selectedWaiver.interests.length
                  ? selectedWaiver.interests.join(", ")
                  : "-"}
              </p>
              <p>
                <strong>Date of Birth:</strong> {selectedWaiver.date_of_birth || "-"}
              </p>
              <p>
                <strong>Address:</strong>{" "}
                {[selectedWaiver.address, selectedWaiver.city, selectedWaiver.state, selectedWaiver.zip]
                  .filter(Boolean)
                  .join(", ") || "-"}
              </p>
              <p>
                <strong>Other Gym Member:</strong> {selectedWaiver.other_gym_member || "-"}
              </p>
              <p>
                <strong>Membership Expires:</strong> {selectedWaiver.membership_expires || "-"}
              </p>
              <p>
                <strong>Heard About Us:</strong> {selectedWaiver.heard_about || "-"}
              </p>
              <p>
                <strong>Looking For:</strong> {selectedWaiver.looking_for || "-"}
              </p>
              <p>
                <strong>Waiver Email:</strong>{" "}
                {selectedWaiver.notification_sent_at
                  ? `Sent ${toDisplayDate(selectedWaiver.notification_sent_at)}`
                  : selectedWaiver.notification_error
                    ? `Not sent - ${selectedWaiver.notification_error}`
                    : "Pending"}
              </p>
              <p>
                <strong>Follow-up Email:</strong>{" "}
                {selectedWaiver.followup_sent_at
                  ? `Sent ${toDisplayDate(selectedWaiver.followup_sent_at)}`
                  : selectedWaiver.followup_eligible === false
                    ? "Not scheduled - signed before follow-ups"
                    : selectedWaiver.followup_error
                      ? `Not sent - ${selectedWaiver.followup_error}`
                      : "Not sent yet"}
              </p>

              <div className="waiver-actions">
                <button
                  type="button"
                  className="viz-toggle"
                  disabled={
                    rowBusy === `followup-${selectedWaiver.id}` ||
                    Boolean(selectedWaiver.followup_sent_at) ||
                    !selectedWaiver.email
                  }
                  onClick={() => sendFollowUpNow(selectedWaiver)}
                  title={
                    selectedWaiver.followup_sent_at
                      ? "A follow-up has already gone out for this waiver."
                      : "Send the trial follow-up now and cancel the automatic one."
                  }
                >
                  {rowBusy === `followup-${selectedWaiver.id}`
                    ? "Sending..."
                    : selectedWaiver.followup_sent_at
                      ? "Follow-up already sent"
                      : "Send follow-up now"}
                </button>
                {selectedWaiver.archived_at ? (
                  <button
                    type="button"
                    className="viz-toggle"
                    disabled={rowBusy === `archive-${selectedWaiver.id}`}
                    onClick={() => setArchived(selectedWaiver, false)}
                  >
                    {rowBusy === `archive-${selectedWaiver.id}` ? "Restoring..." : "Restore waiver"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="danger"
                    disabled={rowBusy === `archive-${selectedWaiver.id}`}
                    onClick={() => setArchived(selectedWaiver, true)}
                    title="Hide from the list and the charts. The signed waiver is kept."
                  >
                    {rowBusy === `archive-${selectedWaiver.id}` ? "Archiving..." : "Archive waiver"}
                  </button>
                )}
              </div>

              {rowError ? <p className="error">{rowError}</p> : null}
              {rowNotice ? (
                <p className="success">
                  {rowNotice.text}
                  {rowNotice.undo ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setArchived(rowNotice.undo.row, rowNotice.undo.archived)}
                    >
                      Undo
                    </button>
                  ) : null}
                </p>
              ) : null}

              <div className="signature-preview">
                <p>
                  <strong>Signature:</strong> {selectedWaiver.signature_name}
                </p>
                <img
                  src={selectedWaiver.signature_data_url}
                  alt={`Signature for ${selectedWaiver.signature_name}`}
                />
              </div>
            </>
          ) : (
            <p className="empty-state">Select a waiver to view details.</p>
          )}
        </div>
      </div>
    </>
  );
}
