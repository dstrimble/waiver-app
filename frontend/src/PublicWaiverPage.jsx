import { useEffect, useRef, useState } from "react";
import { getWaiverText, submitWaiver } from "./api.js";
import SignaturePad from "./components/SignaturePad.jsx";

const INTERESTS = ["BJJ", "Kickboxing", "MMA", "Kids Classes"];

// Nobody younger can sign for themselves, and nobody this age or older can be
// signed for by a parent - they sign their own waiver.
const AGE_OF_MAJORITY = 18;
const MAX_KIDS = 9;

const WHO_OPTIONS = [
  { key: "me", label: "Just me" },
  { key: "kids", label: "My kids" },
  { key: "both", label: "Me and my kids" },
];

const EMPTY_SIGNER = {
  name: "",
  email: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  cellPhone: "",
  homePhone: "",
  otherGymMember: "",
  membershipExpires: "",
  heardAbout: "",
  lookingFor: "",
};

const EMPTY_SELF = { dateOfBirth: "", interests: [] };

let nextKidKey = 0;
function newKid() {
  nextKidKey += 1;
  return { key: nextKidKey, name: "", dateOfBirth: "", interests: ["Kids Classes"] };
}

function ageFromIso(iso, today = new Date()) {
  const [year, month, day] = iso.split("-").map(Number);
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return age;
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The public waiver. One adult signs once for everyone it covers: themselves,
 * their children, or both. Each person gets their own card with a date of
 * birth and the classes they are interested in.
 */
export default function PublicWaiverPage() {
  const padRef = useRef(null);
  const [who, setWho] = useState("me");
  const [signer, setSigner] = useState(EMPTY_SIGNER);
  const [self, setSelf] = useState(EMPTY_SELF);
  const [kids, setKids] = useState(() => [newKid()]);
  const [accepted, setAccepted] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [waiverText, setWaiverText] = useState(null);
  const [waiverTextError, setWaiverTextError] = useState("");

  const includesSelf = who !== "kids";
  const includesKids = who !== "me";

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

  function updateSigner(key, value) {
    setSigner((current) => ({ ...current, [key]: value }));
  }

  function updateKid(key, patch) {
    setKids((list) => list.map((kid) => (kid.key === key ? { ...kid, ...patch } : kid)));
  }

  function addKid() {
    setKids((list) => (list.length >= MAX_KIDS ? list : [...list, newKid()]));
  }

  function removeKid(key) {
    setKids((list) => (list.length > 1 ? list.filter((kid) => kid.key !== key) : list));
  }

  // The people the waiver covers, checked; or a message saying what to fix.
  function collectPeople() {
    const people = [];
    if (includesSelf) {
      const dateOfBirth = displayDateToISO(self.dateOfBirth);
      if (!dateOfBirth) return { problem: "Please enter your date of birth as MM/DD/YYYY." };
      if (ageFromIso(dateOfBirth) < AGE_OF_MAJORITY) {
        return {
          problem:
            'Under 18? A parent or guardian needs to sign for you - they can choose "My kids" and add you.',
        };
      }
      people.push({ isSigner: true, name: signer.name.trim(), dateOfBirth, interests: self.interests });
    }
    if (includesKids) {
      for (const [index, kid] of kids.entries()) {
        const name = kid.name.trim();
        if (!name) return { problem: `Please enter a name for child ${index + 1}.` };
        const dateOfBirth = displayDateToISO(kid.dateOfBirth);
        if (!dateOfBirth) return { problem: `Please enter ${name}'s date of birth as MM/DD/YYYY.` };
        if (ageFromIso(dateOfBirth) >= AGE_OF_MAJORITY) {
          return { problem: `${name} is 18 or over and needs to sign their own waiver.` };
        }
        people.push({ name, dateOfBirth, interests: kid.interests });
      }
    }
    return { people };
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const { people, problem } = collectPeople();
    if (problem) {
      setError(problem);
      return;
    }
    if (!waiverText) {
      setError("The waiver text is still loading. Please try again in a moment.");
      return;
    }
    if (!accepted) {
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
        signer: { ...signer, name: signer.name.trim() },
        participants: people,
        accepted,
        signatureName,
        signatureDataUrl: padRef.current.toDataURL(),
      });

      const onlySelf = people.length === 1 && people[0].isSigner;
      setSuccess(
        onlySelf
          ? "Thanks. Your waiver has been submitted - a PDF copy is on its way to your email."
          : `Thanks. The waiver for ${joinNames(
              people.map((person) => (person.isSigner ? "you" : person.name))
            )} has been submitted - a PDF copy is on its way to your email.`
      );
      setSigner(EMPTY_SIGNER);
      setSelf(EMPTY_SELF);
      setKids([newKid()]);
      setAccepted(false);
      setSignatureName("");
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
          <h2>Who's Training?</h2>
          <p className="required-note">
            <span className="required-mark" aria-hidden="true">*</span> Required fields
          </p>

          <div className="who-grid" role="radiogroup" aria-label="Who is this waiver for?">
            {WHO_OPTIONS.map((option) => {
              const selected = who === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`chip ${selected ? "is-selected" : ""}`}
                  onClick={() => setWho(option.key)}
                >
                  <span className="chip-mark" aria-hidden="true">
                    {selected ? "✓" : "•"}
                  </span>
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
          {includesKids ? (
            <p className="form-hint">
              A parent or guardian fills this in once and signs for every child. Anyone 18 or over
              signs their own waiver.
            </p>
          ) : null}

          <h2>{includesKids ? "Parent / Guardian" : "Your Information"}</h2>
          <div className="field-grid">
            <label>
              <span className="field-label">
                Your Name <span className="required-mark" aria-hidden="true">*</span>
              </span>
              <input value={signer.name} onChange={(e) => updateSigner("name", e.target.value)} required />
            </label>
            <label>
              <span className="field-label">
                Email <span className="required-mark" aria-hidden="true">*</span>
              </span>
              <input
                type="email"
                value={signer.email}
                onChange={(e) => updateSigner("email", e.target.value)}
                required
              />
            </label>
            <label>
              Cell
              <input value={signer.cellPhone} onChange={(e) => updateSigner("cellPhone", e.target.value)} />
            </label>
            <label className="full">
              Address
              <input value={signer.address} onChange={(e) => updateSigner("address", e.target.value)} />
            </label>
            <label>
              City
              <input value={signer.city} onChange={(e) => updateSigner("city", e.target.value)} />
            </label>
            <label>
              State
              <input value={signer.state} maxLength={2} onChange={(e) => updateSigner("state", e.target.value)} />
            </label>
            <label>
              Zip
              <input value={signer.zip} onChange={(e) => updateSigner("zip", e.target.value)} />
            </label>
            <label>
              Home
              <input value={signer.homePhone} onChange={(e) => updateSigner("homePhone", e.target.value)} />
            </label>
            <label>
              Are you a member at another gym?
              <input
                value={signer.otherGymMember}
                onChange={(e) => updateSigner("otherGymMember", e.target.value)}
              />
            </label>
            <label>
              If so, when does your membership expire?
              <input
                value={signer.membershipExpires}
                onChange={(e) => updateSigner("membershipExpires", e.target.value)}
              />
            </label>
            <label className="full">
              How did you hear about us?
              <input value={signer.heardAbout} onChange={(e) => updateSigner("heardAbout", e.target.value)} />
            </label>
            <label className="full">
              What are you looking for in a club?
              <textarea
                rows="3"
                value={signer.lookingFor}
                onChange={(e) => updateSigner("lookingFor", e.target.value)}
              />
            </label>
          </div>

          {includesSelf ? (
            <PersonCard title={includesKids ? "You" : "About You"}>
              <div className="person-grid">
                <DobField
                  label="Your Date of Birth"
                  value={self.dateOfBirth}
                  onChange={(value) => setSelf((current) => ({ ...current, dateOfBirth: value }))}
                />
              </div>
              <InterestChips
                label="Classes you're interested in"
                value={self.interests}
                onChange={(interests) => setSelf((current) => ({ ...current, interests }))}
              />
            </PersonCard>
          ) : null}

          {includesKids ? (
            <>
              {kids.map((kid, index) => (
                <PersonCard
                  key={kid.key}
                  title={`Child ${index + 1}`}
                  onRemove={kids.length > 1 ? () => removeKid(kid.key) : null}
                >
                  <div className="person-grid">
                    <label>
                      <span className="field-label">
                        Child's Name <span className="required-mark" aria-hidden="true">*</span>
                      </span>
                      <input
                        value={kid.name}
                        onChange={(e) => updateKid(kid.key, { name: e.target.value })}
                        required
                      />
                    </label>
                    <DobField
                      label="Date of Birth"
                      value={kid.dateOfBirth}
                      onChange={(value) => updateKid(kid.key, { dateOfBirth: value })}
                    />
                  </div>
                  <InterestChips
                    label="Classes"
                    value={kid.interests}
                    onChange={(interests) => updateKid(kid.key, { interests })}
                  />
                </PersonCard>
              ))}
              {kids.length < MAX_KIDS ? (
                <button type="button" className="add-person" onClick={addKid}>
                  + Add another child
                </button>
              ) : null}
            </>
          ) : null}

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
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              disabled={!waiverText}
              required
            />
            <span>
              {waiverText?.acceptanceStatement ||
                "I have read and agree to the waiver and release above."}
              <span className="required-mark" aria-hidden="true"> *</span>
            </span>
          </label>
          {includesKids ? (
            <p className="form-hint">
              By signing, you confirm you are the parent or legal guardian of each child listed.
            </p>
          ) : null}

          <div className="signature-wrap">
            <label>
              <span className="field-label">
                Signature Name <span className="required-mark" aria-hidden="true">*</span>
              </span>
              <input value={signatureName} onChange={(e) => setSignatureName(e.target.value)} required />
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

function PersonCard({ title, onRemove, children }) {
  return (
    <section className="person-card" aria-label={title}>
      <div className="person-card-head">
        <h3>{title}</h3>
        {onRemove ? (
          <button type="button" className="ghost" onClick={onRemove} aria-label={`Remove ${title}`}>
            Remove
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function InterestChips({ label, value, onChange }) {
  function toggle(interest) {
    onChange(value.includes(interest) ? value.filter((v) => v !== interest) : [...value, interest]);
  }

  return (
    <div className="person-interests">
      <span className="person-sub">{label}</span>
      <div className="interest-grid" role="group" aria-label={label}>
        {INTERESTS.map((interest) => {
          const selected = value.includes(interest);
          return (
            <button
              key={interest}
              type="button"
              className={`chip ${selected ? "is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => toggle(interest)}
            >
              <span className="chip-mark" aria-hidden="true">
                {selected ? "✓" : "•"}
              </span>
              <span>{interest}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** MM/DD/YYYY typed, or picked from the calendar. */
function DobField({ label, value, onChange }) {
  const pickerRef = useRef(null);

  function openCalendar() {
    const picker = pickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }
    picker.click();
  }

  return (
    <label>
      <span className="field-label">
        {label} <span className="required-mark" aria-hidden="true">*</span>
      </span>
      <div className="dob-control">
        <input
          type="tel"
          inputMode="numeric"
          placeholder="MM/DD/YYYY"
          value={value}
          onChange={(e) => onChange(formatDobInput(e.target.value))}
          maxLength={10}
          required
        />
        <button
          type="button"
          className="dob-calendar-btn"
          onClick={openCalendar}
          aria-label={`Open calendar for ${label.toLowerCase()}`}
        >
          📅
        </button>
        <input
          ref={pickerRef}
          className="dob-hidden-picker"
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={displayDateToISO(value)}
          onChange={(e) => onChange(isoToDisplayDate(e.target.value))}
        />
      </div>
    </label>
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
