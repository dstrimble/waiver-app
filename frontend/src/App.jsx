import { useMemo, useRef, useState } from "react";
import {
  adminChangePasscode,
  adminGetWaivers,
  submitWaiver,
  verifyAdmin,
} from "./api.js";
import SignaturePad from "./components/SignaturePad.jsx";

const INTERESTS = ["BJJ", "Kickboxing", "MMA", "Kids Classes"];

const WAIVER_PARAGRAPHS = [
  "Assumption of risk: The use of Gravitas Mixed Martial Arts naturally involves the risk of injury whether you or someone else causes it. As such, you understand and voluntarily accept this risk and agree that Gravitas Mixed Martial Arts will not be liable for injury, including, without limitation, personal, bodily or mental injury, economic loss or any damage to you or unborn child resulting from negligence of Gravitas Mixed Martial Arts or anyone on Gravitas Mixed Martial Arts' behalf or anyone using the facility, whether the negligence is sole, joint, concurrent, active or passive.",
  "By signing this waiver you acknowledge your assumption of risk and warrant, represent, and agree that you are in good physical condition and that you have no disability, impairment, or ailment preventing you from engaging in active or passive exercise or that will be detrimental or inimical to your health, safety, comfort, or physical condition while engaging or participating in exercise. You also agree that you will not use the facilities with any open cuts, abrasions, open sores, infections, maladies with potential of harm to others, or the like, in accordance with public health requirements.",
  "It is further agreed that all exercises including the use of the facility (including parking lot), weights, number of repetitions, and use of any and all machinery, equipment, and apparatus designed for exercising shall be at your sole risk. Notwithstanding any consultation on exercise programs which may be provided by Gravitas Mixed Martial Arts employees, it is hereby understood that the selection of exercise programs, methods and types of equipment shall be your entire responsibility, and Gravitas Mixed Martial Arts shall not be liable to you for any claims, demands, injuries, damages, or actions arising due to injury to guest's person or property out of or in connection with the use by guest of the services and facilities of Gravitas Mixed Martial Arts on the premises where the same is located."
];

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
  const isAdminPage = normalizedPath === "/waiver/admin";
  const isWaiverPage = normalizedPath === "/waiver" || normalizedPath === "/";

  if (isAdminPage) return <AdminPage />;
  if (isWaiverPage) return <PublicWaiverPage />;

  return (
    <main className="page">
      <section className="card">
        <header className="hero">
          <p className="kicker">Not Found</p>
          <h1>Page Not Found</h1>
          <p>Use /waiver for the public form or /waiver/admin for administration.</p>
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
  const [changeForm, setChangeForm] = useState({
    currentPasscode: "",
    newPasscode: "",
    confirmPasscode: "",
  });

  const today = useMemo(() => new Date(), []);
  const defaultEnd = toDateOnly(today);
  const defaultStart = toDateOnly(new Date(today.getTime() - 29 * 86400000));
  const [dateRange, setDateRange] = useState({ start: defaultStart, end: defaultEnd });

  function toDisplayDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  }

  async function unlockAdmin(e) {
    e.preventDefault();
    setAdminBusy(true);
    setAdminError("");
    try {
      await verifyAdmin(passcodeInput);
      setAdmin({ passcode: passcodeInput });
      setPasscodeInput("");
      await loadWaivers(passcodeInput, dateRange.start, dateRange.end);
    } catch (err) {
      setAdminError(err.message || "Could not unlock admin.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function loadWaivers(passcode, start, end) {
    setWaiversLoading(true);
    setWaiversError("");
    try {
      const rows = await adminGetWaivers(passcode, { start, end });
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

  async function runDateFilter(e) {
    e.preventDefault();
    if (!admin?.passcode) return;
    await loadWaivers(admin.passcode, dateRange.start, dateRange.end);
  }

  function exitAdmin() {
    setAdmin(null);
    setPasscodeInput("");
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
    if (!admin?.passcode) return;

    setChangeBusy(true);
    setChangeError("");
    setChangeSuccess("");
    try {
      await adminChangePasscode(admin.passcode, changeForm);
      setAdmin({ passcode: changeForm.newPasscode });
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
                <h2>Admin</h2>
                <div className="admin-live-actions">
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
                        className={`waiver-row ${selectedWaiver?.id === row.id ? "is-selected" : ""}`}
                        onClick={() => setSelectedWaiver(row)}
                      >
                        <strong>{row.name}</strong>
                        <span>{row.email}</span>
                        <span>{toDisplayDate(row.submitted_at)}</span>
                      </button>
                    ))
                  )}
                </div>

                <div className="waiver-detail">
                  {selectedWaiver ? (
                    <>
                      <h3>{selectedWaiver.name}</h3>
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
              {adminError ? <p className="error">{adminError}</p> : null}
            </form>
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

      setSuccess("Thanks. Your waiver has been submitted.");
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
            {WAIVER_PARAGRAPHS.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>

          <label className="accept-row">
            <input
              type="checkbox"
              checked={form.accepted}
              onChange={(e) => update("accepted", e.target.checked)}
              required
            />
            <span>
              I have read and agree to the waiver and release above.
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

          <button className="submit" type="submit" disabled={saving}>
            {saving ? "Submitting..." : "Submit Waiver"}
          </button>
        </form>
      </section>
    </main>
  );
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
