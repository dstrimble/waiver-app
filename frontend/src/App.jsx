import { useEffect, useMemo, useRef, useState } from "react";
import {
  adminApproveUser,
  adminChangePasscode,
  adminArchiveWaiver,
  adminGetMe,
  adminGetSquarespace,
  adminGetStats,
  adminGetWaivers,
  adminGoogleSignIn,
  adminListUsers,
  adminLogout,
  adminRemoveUser,
  adminSendFollowUp,
  getAdminAuthConfig,
  getWaiverText,
  submitWaiver,
  verifyAdmin,
} from "./api.js";
import AdminUsers from "./components/AdminUsers.jsx";
import GoogleSignIn from "./components/GoogleSignIn.jsx";
import SignaturePad from "./components/SignaturePad.jsx";
import SquarespaceSection from "./components/Squarespace.jsx";
import {
  CategoryColumns,
  InterestMix,
  RankedBars,
  SignupsOverTime,
  StatTiles,
  bucketByInterest,
  bucketDaily,
  foldTail,
} from "./components/Charts.jsx";

const INTERESTS = ["BJJ", "Kickboxing", "MMA", "Kids Classes"];

const EMPTY_FORM = {
  interests: [],
  name: "",
  parentName: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  cellPhone: "",
  homePhone: "",
  email: "",
  dateOfBirth: "",
  otherGymMember: "",
  membershipExpires: "",
  heardAbout: "",
  lookingFor: "",
  accepted: false,
  signatureName: "",
};

export default function App() {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const isAdminPage = normalizedPath === "/admin";
  const isWaiverPage = normalizedPath === "/waiver" || normalizedPath === "/";

  if (isAdminPage) return <AdminPage />;
  if (isWaiverPage) return <PublicWaiverPage />;

  return (
    <main className="page">
      <section className="card">
        <header className="hero">
          <p className="kicker">Not Found</p>
          <h1>Page Not Found</h1>
          <p>Use /waiver for the public form or /admin for administration.</p>
        </header>
      </section>
    </main>
  );
}

function AdminPage() {
  const [admin, setAdmin] = useState(null);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [waiversLoading, setWaiversLoading] = useState(false);
  const [waiversError, setWaiversError] = useState("");
  const [waivers, setWaivers] = useState([]);
  const [selectedWaiver, setSelectedWaiver] = useState(null);
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeError, setChangeError] = useState("");
  const [changeSuccess, setChangeSuccess] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState("");
  const [granularity, setGranularity] = useState("month");
  const [rangeDays, setRangeDays] = useState(365);
  const [rowBusy, setRowBusy] = useState("");
  const [rowError, setRowError] = useState("");
  const [rowNotice, setRowNotice] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [squarespace, setSquarespace] = useState(null);
  const [squarespaceLoading, setSquarespaceLoading] = useState(false);
  const [squarespaceError, setSquarespaceError] = useState("");
  const [authConfig, setAuthConfig] = useState(null);
  const [pendingNotice, setPendingNotice] = useState("");
  const [adminUsers, setAdminUsers] = useState([]);
  const [usersBusy, setUsersBusy] = useState(null);
  const [usersError, setUsersError] = useState("");
  const [showAccess, setShowAccess] = useState(false);
  const [changeForm, setChangeForm] = useState({
    currentPasscode: "",
    newPasscode: "",
    confirmPasscode: "",
  });

  const today = useMemo(() => new Date(), []);
  const defaultEnd = toDateOnly(today);
  const defaultStart = toDateOnly(new Date(today.getTime() - 29 * 86400000));
  const [dateRange, setDateRange] = useState({ start: defaultStart, end: defaultEnd });

  // Load the sign-in options, and pick a Google session back up after a reload.
  useEffect(() => {
    let cancelled = false;
    getAdminAuthConfig()
      .then((config) => {
        if (!cancelled) setAuthConfig(config);
      })
      .catch(() => {});
    const token = readStoredToken();
    if (token) {
      adminGetMe({ token })
        .then(({ user }) => {
          if (!cancelled) enterAdmin({ token, user });
        })
        .catch(() => clearStoredToken());
    }
    return () => {
      cancelled = true;
    };
  }, []);

  function toDisplayDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  }

  // `auth` is { passcode } or, for a Google admin, { token, user }.
  async function enterAdmin(auth) {
    setAdmin(auth);
    setPendingNotice("");
    // Not awaited: the first Squarespace pull takes several seconds, and the
    // waiver list should not wait on it.
    loadSquarespace(auth);
    loadUsers(auth);
    await Promise.all([loadWaivers(auth, dateRange.start, dateRange.end), loadStats(auth)]);
  }

  async function unlockAdmin(e) {
    e.preventDefault();
    setAdminBusy(true);
    setAdminError("");
    try {
      const auth = { passcode: passcodeInput };
      await verifyAdmin(auth);
      setPasscodeInput("");
      await enterAdmin(auth);
    } catch (err) {
      setAdminError(err.message || "Could not unlock admin.");
    } finally {
      setAdminBusy(false);
    }
  }

  // A Google account only gets in once approved; until then the backend just
  // files the request.
  async function signInWithGoogle(credential) {
    setAdminBusy(true);
    setAdminError("");
    setPendingNotice("");
    try {
      const result = await adminGoogleSignIn(credential);
      if (result.status === "approved") {
        storeToken(result.token);
        await enterAdmin({ token: result.token, user: result.user });
      } else {
        setPendingNotice(
          `Thanks - your request for ${result.email} is in. An admin has to approve it before you can see anything here; sign in again once they have.`
        );
      }
    } catch (err) {
      setAdminError(err.message || "Google sign-in failed.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function loadUsers(auth) {
    setUsersError("");
    try {
      setAdminUsers(await adminListUsers(auth));
    } catch (err) {
      setUsersError(err.message || "Failed to load admin access.");
    }
  }

  async function approveUser(user) {
    if (!admin) return;
    setUsersBusy(user.id);
    setUsersError("");
    try {
      await adminApproveUser(admin, user.id);
      await loadUsers(admin);
    } catch (err) {
      setUsersError(err.message || "Could not approve access.");
    } finally {
      setUsersBusy(null);
    }
  }

  async function removeUser(user) {
    if (!admin) return;
    setUsersBusy(user.id);
    setUsersError("");
    try {
      await adminRemoveUser(admin, user.id);
      await loadUsers(admin);
    } catch (err) {
      setUsersError(err.message || "Could not remove access.");
    } finally {
      setUsersBusy(null);
    }
  }

  async function loadWaivers(auth, start, end, includeArchived = showArchived) {
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

  async function loadStats(auth) {
    setStatsError("");
    try {
      setStats(await adminGetStats(auth));
    } catch (err) {
      setStatsError(err.message || "Failed to load stats.");
    }
  }

  async function loadSquarespace(auth, refresh = false) {
    setSquarespaceLoading(true);
    setSquarespaceError("");
    try {
      setSquarespace(await adminGetSquarespace(auth, { refresh }));
    } catch (err) {
      setSquarespaceError(err.message || "Failed to load Squarespace data.");
    } finally {
      setSquarespaceLoading(false);
    }
  }

  async function runDateFilter(e) {
    e.preventDefault();
    if (!admin) return;
    await loadWaivers(admin, dateRange.start, dateRange.end);
  }

  // Sending by hand claims the waiver the same way the weekly sweep does, so
  // the automatic follow-up is suppressed and nobody receives two.
  async function sendFollowUpNow(row) {
    if (!admin) return;
    setRowBusy(`followup-${row.id}`);
    setRowError("");
    setRowNotice(null);
    try {
      const result = await adminSendFollowUp(admin, row.id);
      setRowNotice({
        text: `Follow-up sent to ${result.sentTo}. The automatic one is now cancelled.`,
      });
      await Promise.all([
        loadWaivers(admin, dateRange.start, dateRange.end),
        loadStats(admin),
      ]);
    } catch (err) {
      setRowError(err.message || "Could not send the follow-up.");
    } finally {
      setRowBusy("");
    }
  }

  // Archiving is reversible, so it needs no confirmation dialog - it offers an
  // undo instead, and the record itself is never destroyed.
  async function setArchived(row, archived) {
    if (!admin) return;
    setRowBusy(`archive-${row.id}`);
    setRowError("");
    setRowNotice(null);
    try {
      await adminArchiveWaiver(admin, row.id, archived);
      setRowNotice({
        text: archived
          ? `Archived ${row.name}. The signed waiver is kept, just hidden.`
          : `Restored ${row.name}.`,
        undo: { row, archived: !archived },
      });
      if (archived && !showArchived) setSelectedWaiver(null);
      await Promise.all([
        loadWaivers(admin, dateRange.start, dateRange.end),
        loadStats(admin),
      ]);
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
    if (admin) {
      await loadWaivers(admin, dateRange.start, dateRange.end, next);
    }
  }

  function exitAdmin() {
    if (admin?.token) {
      adminLogout(admin).catch(() => {});
      clearStoredToken();
    }
    setAdmin(null);
    setAdminUsers([]);
    setUsersError("");
    setShowAccess(false);
    setPasscodeInput("");
    setStats(null);
    setStatsError("");
    setSquarespace(null);
    setSquarespaceError("");
    setRowError("");
    setRowNotice(null);
    setShowArchived(false);
    setAdminError("");
    setWaiversError("");
    setWaivers([]);
    setSelectedWaiver(null);
    setShowChangePassword(false);
    setChangeError("");
    setChangeSuccess("");
    setChangeForm({
      currentPasscode: "",
      newPasscode: "",
      confirmPasscode: "",
    });
  }

  async function submitPasscodeChange(e) {
    e.preventDefault();
    if (!admin) return;

    setChangeBusy(true);
    setChangeError("");
    setChangeSuccess("");
    try {
      await adminChangePasscode(admin, changeForm);
      // A Google session is unaffected; a passcode session moves to the new one.
      setAdmin((current) => (current?.token ? current : { passcode: changeForm.newPasscode }));
      setChangeForm({
        currentPasscode: "",
        newPasscode: "",
        confirmPasscode: "",
      });
      setChangeSuccess("Admin password updated.");
    } catch (err) {
      setChangeError(err.message || "Failed to update password.");
    } finally {
      setChangeBusy(false);
    }
  }

  function updateChangeField(key, value) {
    setChangeForm((current) => ({ ...current, [key]: value }));
  }

  const timeline = useMemo(
    () => (stats ? bucketDaily(stats.daily, granularity, rangeDays) : []),
    [stats, granularity, rangeDays]
  );
  const interestBuckets = useMemo(
    () => (stats ? bucketByInterest(stats.dailyByInterest, granularity, rangeDays) : []),
    [stats, granularity, rangeDays]
  );
  const pendingCount = adminUsers.filter((u) => u.status === "pending").length;
  const heardAboutRows = useMemo(
    () => (stats ? foldTail(stats.heardAbout) : []),
    [stats]
  );

  return (
    <main className="page">
      <section className="card">
        <header className="hero">
          <p className="kicker">Administration</p>
          <h1>Waiver Admin</h1>
          <p>View signed waivers and manage admin access.</p>
        </header>

        <section className="admin-shell">
          {admin ? (
            <div className="admin-live">
              <div className="admin-live-head">
                <div>
                  <h2>Admin</h2>
                  {admin.user ? <p className="admin-who">Signed in as {admin.user.email}</p> : null}
                </div>
                <div className="admin-live-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setShowAccess((value) => !value)}
                    aria-expanded={showAccess}
                    aria-controls="admin-access-panel"
                  >
                    {pendingCount ? `Admin access (${pendingCount} waiting)` : "Admin access"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setShowChangePassword((value) => !value)}
                    aria-expanded={showChangePassword}
                    aria-controls="change-password-panel"
                  >
                    {showChangePassword ? "Hide password form" : "Change password"}
                  </button>
                  <button type="button" className="ghost" onClick={exitAdmin}>
                    Exit Admin
                  </button>
                </div>
              </div>

              {showChangePassword ? (
                <form
                  id="change-password-panel"
                  className="admin-passcode-form"
                  onSubmit={submitPasscodeChange}
                >
                  <label>
                    Current Passcode
                    <input
                      type="password"
                      value={changeForm.currentPasscode}
                      onChange={(e) => updateChangeField("currentPasscode", e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    New Passcode
                    <input
                      type="password"
                      minLength={8}
                      value={changeForm.newPasscode}
                      onChange={(e) => updateChangeField("newPasscode", e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Confirm New Passcode
                    <input
                      type="password"
                      minLength={8}
                      value={changeForm.confirmPasscode}
                      onChange={(e) => updateChangeField("confirmPasscode", e.target.value)}
                      required
                    />
                  </label>
                  <button type="submit" className="ghost" disabled={changeBusy}>
                    {changeBusy ? "Saving..." : "Save Password"}
                  </button>
                </form>
              ) : null}
              {changeError ? <p className="error">{changeError}</p> : null}
              {changeSuccess ? <p className="success">{changeSuccess}</p> : null}

              {showAccess ? (
                <AdminUsers
                  users={adminUsers}
                  currentUserId={admin.user?.id}
                  busyId={usersBusy}
                  onApprove={approveUser}
                  onRemove={removeUser}
                />
              ) : null}
              {usersError ? <p className="error">{usersError}</p> : null}

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

                  <SignupsOverTime
                    points={timeline}
                    granularity={granularity}
                    onGranularity={setGranularity}
                  />

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

              <SquarespaceSection
                data={squarespace}
                loading={squarespaceLoading}
                error={squarespaceError}
                onRefresh={() => loadSquarespace(admin, true)}
              />

              <form className="admin-filters" onSubmit={runDateFilter}>
                <label>
                  Start Date
                  <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) =>
                      setDateRange((current) => ({ ...current, start: e.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  End Date
                  <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) =>
                      setDateRange((current) => ({ ...current, end: e.target.value }))
                    }
                    required
                  />
                </label>
                <button type="submit" className="submit admin-refresh" disabled={waiversLoading}>
                  {waiversLoading ? "Loading..." : "Load Waivers"}
                </button>
                <label className="archived-toggle">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={toggleShowArchived}
                  />
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
                        {selectedWaiver.archived_at ? (
                          <span className="badge-archived">Archived</span>
                        ) : null}
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
                            {rowBusy === `archive-${selectedWaiver.id}`
                              ? "Restoring..."
                              : "Restore waiver"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="danger"
                            disabled={rowBusy === `archive-${selectedWaiver.id}`}
                            onClick={() => setArchived(selectedWaiver, true)}
                            title="Hide from the list and the charts. The signed waiver is kept."
                          >
                            {rowBusy === `archive-${selectedWaiver.id}`
                              ? "Archiving..."
                              : "Archive waiver"}
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
            </div>
          ) : (
            <div className="admin-signin">
              {authConfig?.googleClientId ? (
                <>
                  <GoogleSignIn
                    clientId={authConfig.googleClientId}
                    onCredential={signInWithGoogle}
                    onError={setAdminError}
                  />
                  <p className="admin-signin-note">
                    New Google accounts need an existing admin to approve them before they can
                    see anything.
                  </p>
                  {pendingNotice ? <p className="success">{pendingNotice}</p> : null}
                  <p className="admin-signin-divider">or use the passcode</p>
                </>
              ) : null}
              <form className="admin-login" onSubmit={unlockAdmin}>
                <label>
                  Admin Passcode
                  <input
                    type="password"
                    value={passcodeInput}
                    onChange={(e) => setPasscodeInput(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="ghost" disabled={adminBusy}>
                  {adminBusy ? "Unlocking..." : "Unlock Admin"}
                </button>
              </form>
              {adminError ? <p className="error">{adminError}</p> : null}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function PublicWaiverPage() {
  const padRef = useRef(null);
  const dobPickerRef = useRef(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [waiverText, setWaiverText] = useState(null);
  const [waiverTextError, setWaiverTextError] = useState("");

  // The waiver copy lives on the backend so the on-screen text and the emailed
  // PDF are always the same document.
  useEffect(() => {
    let cancelled = false;
    getWaiverText()
      .then((data) => {
        if (!cancelled) setWaiverText(data);
      })
      .catch(() => {
        if (!cancelled) {
          setWaiverTextError("Could not load the waiver text. Please refresh the page.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleInterest(value) {
    setForm((f) => ({
      ...f,
      interests: f.interests.includes(value)
        ? f.interests.filter((v) => v !== value)
        : [...f.interests, value],
    }));
  }

  function handleDobTextChange(value) {
    setForm((current) => ({
      ...current,
      dateOfBirth: formatDobInput(value),
    }));
  }

  function handleDobPickerChange(value) {
    setForm((current) => ({
      ...current,
      dateOfBirth: isoToDisplayDate(value),
    }));
  }

  function openDobCalendar() {
    const picker = dobPickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }
    picker.click();
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const dobIso = displayDateToISO(form.dateOfBirth);
    if (!form.dateOfBirth) {
      setError("Date of Birth is required.");
      return;
    }
    if (!dobIso) {
      setError("Date of Birth must be MM/DD/YYYY.");
      return;
    }

    if (!waiverText) {
      setError("The waiver text is still loading. Please try again in a moment.");
      return;
    }
    if (!form.accepted) {
      setError("You must acknowledge the waiver to continue.");
      return;
    }
    if (!padRef.current || padRef.current.isEmpty()) {
      setError("Please draw your signature.");
      return;
    }

    setSaving(true);
    try {
      await submitWaiver({
        ...form,
        dateOfBirth: dobIso,
        signatureDataUrl: padRef.current.toDataURL(),
      });

      setSuccess(
        "Thanks. Your waiver has been submitted - a PDF copy is on its way to your email."
      );
      setForm(EMPTY_FORM);
      padRef.current.clear();
    } catch (err) {
      setError(err.message || "Could not submit waiver.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <section className="card">
        <header className="hero">
          <p className="kicker">Guest Intake</p>
          <h1>Waiver & Release</h1>
          <p>Complete this form and sign below before participating in classes.</p>
        </header>

        <form className="waiver-form" onSubmit={onSubmit}>
          <h2>Guest Information</h2>
          <p className="required-note">
            <span className="required-mark" aria-hidden="true">*</span> Required fields
          </p>

          <div className="interest-grid" role="group" aria-label="Interested in">
            {INTERESTS.map((label) => {
              const selected = form.interests.includes(label);
              return (
                <button
                  key={label}
                  type="button"
                  className={`chip ${selected ? "is-selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => toggleInterest(label)}
                >
                  <span className="chip-mark" aria-hidden="true">
                    {selected ? "✓" : "•"}
                  </span>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          <div className="field-grid">
            <label>
              <span className="field-label">
                Name <span className="required-mark" aria-hidden="true">*</span>
              </span>
              <input value={form.name} onChange={(e) => update("name", e.target.value)} required />
            </label>
            <label>
              Parent Name (if under age 18)
              <input value={form.parentName} onChange={(e) => update("parentName", e.target.value)} />
            </label>
            <label className="full">
              Address
              <input value={form.address} onChange={(e) => update("address", e.target.value)} />
            </label>
            <label>
              City
              <input value={form.city} onChange={(e) => update("city", e.target.value)} />
            </label>
            <label>
              State
              <input value={form.state} maxLength={2} onChange={(e) => update("state", e.target.value)} />
            </label>
            <label>
              Zip
              <input value={form.zip} onChange={(e) => update("zip", e.target.value)} />
            </label>
            <label>
              Cell
              <input value={form.cellPhone} onChange={(e) => update("cellPhone", e.target.value)} />
            </label>
            <label>
              Home
              <input value={form.homePhone} onChange={(e) => update("homePhone", e.target.value)} />
            </label>
            <label>
              <span className="field-label">
                Email <span className="required-mark" aria-hidden="true">*</span>
              </span>
              <input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} required />
            </label>
            <label>
              Date of Birth
              <div className="dob-control">
                <input
                  type="tel"
                  inputMode="numeric"
                  placeholder="MM/DD/YYYY"
                  value={form.dateOfBirth}
                  onChange={(e) => handleDobTextChange(e.target.value)}
                  maxLength={10}
                  required
                />
                <button
                  type="button"
                  className="dob-calendar-btn"
                  onClick={openDobCalendar}
                  aria-label="Open date picker"
                >
                  📅
                </button>
                <input
                  ref={dobPickerRef}
                  className="dob-hidden-picker"
                  type="date"
                  tabIndex={-1}
                  aria-hidden="true"
                  value={displayDateToISO(form.dateOfBirth)}
                  onChange={(e) => handleDobPickerChange(e.target.value)}
                />
              </div>
            </label>
            <label>
              Are you a member at another gym?
              <input value={form.otherGymMember} onChange={(e) => update("otherGymMember", e.target.value)} />
            </label>
            <label>
              If so, when does your membership expire?
              <input value={form.membershipExpires} onChange={(e) => update("membershipExpires", e.target.value)} />
            </label>
            <label className="full">
              How did you hear about us?
              <input value={form.heardAbout} onChange={(e) => update("heardAbout", e.target.value)} />
            </label>
            <label className="full">
              What are you looking for in a club?
              <textarea rows="3" value={form.lookingFor} onChange={(e) => update("lookingFor", e.target.value)} />
            </label>
          </div>

          <h2>Waiver & Release</h2>
          <div className="waiver-copy">
            {waiverTextError ? (
              <p className="error">{waiverTextError}</p>
            ) : waiverText ? (
              waiverText.paragraphs.map((text) => <p key={text}>{text}</p>)
            ) : (
              <p className="empty-state">Loading waiver text...</p>
            )}
          </div>

          <label className="accept-row">
            <input
              type="checkbox"
              checked={form.accepted}
              onChange={(e) => update("accepted", e.target.checked)}
              disabled={!waiverText}
              required
            />
            <span>
              {waiverText?.acceptanceStatement ||
                "I have read and agree to the waiver and release above."}
              <span className="required-mark" aria-hidden="true"> *</span>
            </span>
          </label>

          <div className="signature-wrap">
            <label>
              <span className="field-label">
                Signature Name <span className="required-mark" aria-hidden="true">*</span>
              </span>
              <input
                value={form.signatureName}
                onChange={(e) => update("signatureName", e.target.value)}
                required
              />
            </label>
            <div className="signature-panel">
              <div className="signature-head">
                <p>Draw Signature</p>
                <button type="button" className="ghost" onClick={() => padRef.current?.clear()}>
                  Clear
                </button>
              </div>
              <SignaturePad ref={padRef} />
            </div>
          </div>

          {error ? <p className="error">{error}</p> : null}
          {success ? <p className="success">{success}</p> : null}

          <button className="submit" type="submit" disabled={saving || !waiverText}>
            {saving ? "Submitting..." : "Submit Waiver"}
          </button>
        </form>
      </section>
    </main>
  );
}

// A Google admin stays signed in across reloads. Storage can be unavailable
// (private windows, blocked site data); then the session lasts for this visit.
const SESSION_KEY = "waiver-admin-session";

function readStoredToken() {
  try {
    return window.localStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

function storeToken(token) {
  try {
    window.localStorage.setItem(SESSION_KEY, token);
  } catch {
    // see above
  }
}

function clearStoredToken() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // see above
  }
}

function toDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDateToISO(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, month, day, year] = match;
  return `${year}-${month}-${day}`;
}

function isoToDisplayDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  const [, year, month, day] = match;
  return `${month}/${day}/${year}`;
}

function formatDobInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  const parts = [];
  if (digits.length > 0) parts.push(digits.slice(0, 2));
  if (digits.length > 2) parts.push(digits.slice(2, 4));
  if (digits.length > 4) parts.push(digits.slice(4, 8));
  return parts.join("/");
}
