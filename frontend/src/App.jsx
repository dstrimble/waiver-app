import { useEffect, useRef, useState } from "react";
import { getWaiverText, submitWaiver } from "./api.js";
import SignaturePad from "./components/SignaturePad.jsx";
import AdminApp, { adminRoute } from "./admin/AdminApp.jsx";

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
  const isWaiverPage = normalizedPath === "/waiver" || normalizedPath === "/";

  if (adminRoute(normalizedPath)) return <AdminApp />;
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
