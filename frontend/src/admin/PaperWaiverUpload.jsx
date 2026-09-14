import { useEffect, useRef, useState } from "react";
import { adminSavePaperWaiver } from "../api.js";
import { cropToPage, FULL_FRAME, loadPhoto } from "./paperScan.js";

const INTERESTS = ["BJJ", "Kickboxing", "MMA", "Kids Classes"];

const WHO_OPTIONS = [
  { key: "me", label: "Just the signer" },
  { key: "kids", label: "Their kids" },
  { key: "both", label: "Signer and kids" },
];

const SIGNER_FIELDS = [
  { key: "name", label: "Name (signer)" },
  { key: "email", label: "Email", type: "email" },
  { key: "cellPhone", label: "Cell" },
  { key: "homePhone", label: "Home" },
  { key: "address", label: "Address", full: true },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "Zip" },
  { key: "otherGymMember", label: "Member at another gym?" },
  { key: "membershipExpires", label: "That membership expires" },
  { key: "heardAbout", label: "How they heard about us", full: true },
  { key: "lookingFor", label: "What they're looking for in a club", full: true },
];

const EMPTY_SIGNER = Object.fromEntries(SIGNER_FIELDS.map((field) => [field.key, ""]));
const CORNER_NAMES = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];

let nextKidKey = 0;
function newKid() {
  nextKidKey += 1;
  return { key: nextKidKey, name: "", dateOfBirth: "", interests: ["Kids Classes"] };
}

function blankForm() {
  return {
    who: "me",
    signer: EMPTY_SIGNER,
    self: { dateOfBirth: "", interests: [] },
    kids: [newKid()],
    signedOn: "",
  };
}

const clamp = (value) => Math.min(1, Math.max(0, value));

/**
 * Enter a waiver signed on paper: photograph it, crop the photo to the page,
 * type in the details from the paper, and save it with the cropped photo as
 * the signature. It then goes out like an online waiver.
 */
export default function PaperWaiverUpload({ auth, onSaved, onCancel }) {
  const [loading, setLoading] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [corners, setCorners] = useState(FULL_FRAME);
  const [preview, setPreview] = useState("");
  const [form, setForm] = useState(blankForm);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const includesSelf = form.who !== "kids";
  const includesKids = form.who !== "me";

  // Re-crop once the corners stop moving, rather than on every pointer move.
  useEffect(() => {
    if (!photo) return undefined;
    const timer = setTimeout(() => {
      try {
        setPreview(cropToPage(photo, corners));
      } catch {
        setPreview("");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [photo, corners]);

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setLoading(true);
    try {
      setPhoto(await loadPhoto(file));
    } catch (err) {
      setError(err.message || "That photo could not be opened.");
    } finally {
      setLoading(false);
    }
  }

  function updateSigner(key, value) {
    setForm((current) => ({ ...current, signer: { ...current.signer, [key]: value } }));
  }

  function updateSelf(patch) {
    setForm((current) => ({ ...current, self: { ...current.self, ...patch } }));
  }

  function updateKid(key, patch) {
    setForm((current) => ({
      ...current,
      kids: current.kids.map((kid) => (kid.key === key ? { ...kid, ...patch } : kid)),
    }));
  }

  function moveCorner(index, point) {
    setCorners((current) => current.map((corner, i) => (i === index ? point : corner)));
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    const participants = [];
    if (includesSelf) {
      participants.push({ isSigner: true, dateOfBirth: form.self.dateOfBirth, interests: form.self.interests });
    }
    if (includesKids) {
      for (const kid of form.kids) {
        participants.push({ name: kid.name, dateOfBirth: kid.dateOfBirth, interests: kid.interests });
      }
    }

    setSaving(true);
    try {
      const result = await adminSavePaperWaiver(auth, {
        signer: form.signer,
        participants,
        signedOn: form.signedOn,
        confirmedSigned: confirmed,
        scanDataUrl: cropToPage(photo, corners),
      });
      onSaved({ ...result, name: form.signer.name.trim() });
    } catch (err) {
      setError(err.message || "Could not save the paper waiver.");
      setSaving(false);
    }
  }

  return (
    <section className="paper-waiver" aria-label="Add a paper waiver">
      <div className="person-card-head">
        <h3>Add a paper waiver</h3>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {!photo ? (
        <>
          <p className="form-hint">
            Photograph the signed waiver flat and in good light. You'll crop it to the page and type
            in the details from the paper.
          </p>
          <label className="paper-pick">
            Photo of the signed waiver
            <input type="file" accept="image/*" onChange={onPhoto} disabled={loading} />
          </label>
          {error ? <p className="error">{error}</p> : null}
        </>
      ) : (
        <form className="paper-review" onSubmit={save}>
          <div className="paper-review-photo">
            <p className="person-sub">Drag each corner onto a corner of the page.</p>
            <PageCorners src={photo.dataUrl} corners={corners} onMove={moveCorner} />
            <button type="button" className="viz-toggle" onClick={() => setCorners(FULL_FRAME)}>
              Use the whole photo
            </button>
            {preview ? (
              <figure className="paper-preview">
                <img src={preview} alt="The waiver as it will be saved" />
                <figcaption>Saved as the signed waiver</figcaption>
              </figure>
            ) : null}
          </div>

          <div className="paper-review-fields">
            <div className="viz-segmented" role="group" aria-label="Who the waiver covers">
              {WHO_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={form.who === option.key ? "is-active" : ""}
                  aria-pressed={form.who === option.key}
                  onClick={() => setForm((current) => ({ ...current, who: option.key }))}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="field-grid">
              {SIGNER_FIELDS.map((field) => (
                <label key={field.key} className={field.full ? "full" : undefined}>
                  {field.label}
                  <input
                    type={field.type || "text"}
                    value={form.signer[field.key]}
                    onChange={(e) => updateSigner(field.key, e.target.value)}
                    required={field.key === "name"}
                  />
                </label>
              ))}
              <label>
                Date signed
                <input
                  type="date"
                  value={form.signedOn}
                  onChange={(e) => setForm((current) => ({ ...current, signedOn: e.target.value }))}
                />
              </label>
            </div>

            {includesSelf ? (
              <section className="person-card" aria-label="Signer">
                <div className="person-grid">
                  <label>
                    Signer's date of birth
                    <input
                      type="date"
                      value={form.self.dateOfBirth}
                      onChange={(e) => updateSelf({ dateOfBirth: e.target.value })}
                    />
                  </label>
                </div>
                <InterestChecks
                  label="Signer's classes"
                  value={form.self.interests}
                  onChange={(interests) => updateSelf({ interests })}
                />
              </section>
            ) : null}

            {includesKids
              ? form.kids.map((kid, index) => (
                  <section key={kid.key} className="person-card" aria-label={`Child ${index + 1}`}>
                    <div className="person-card-head">
                      <h3>Child {index + 1}</h3>
                      {form.kids.length > 1 ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              kids: current.kids.filter((k) => k.key !== kid.key),
                            }))
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <div className="person-grid">
                      <label>
                        Child's name
                        <input
                          value={kid.name}
                          onChange={(e) => updateKid(kid.key, { name: e.target.value })}
                          required
                        />
                      </label>
                      <label>
                        Date of birth
                        <input
                          type="date"
                          value={kid.dateOfBirth}
                          onChange={(e) => updateKid(kid.key, { dateOfBirth: e.target.value })}
                        />
                      </label>
                    </div>
                    <InterestChecks
                      label="Classes"
                      value={kid.interests}
                      onChange={(interests) => updateKid(kid.key, { interests })}
                    />
                  </section>
                ))
              : null}
            {includesKids ? (
              <button
                type="button"
                className="add-person"
                onClick={() => setForm((current) => ({ ...current, kids: [...current.kids, newKid()] }))}
              >
                + Add another child
              </button>
            ) : null}

            <label className="accept-row">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>I've checked these details against the paper, and it is signed.</span>
            </label>

            {error ? <p className="error">{error}</p> : null}
            <button type="submit" className="submit" disabled={saving || !confirmed}>
              {saving ? "Saving..." : "Save paper waiver"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function InterestChecks({ label, value, onChange }) {
  return (
    <fieldset className="paper-interests">
      <legend className="person-sub">{label}</legend>
      {INTERESTS.map((interest) => (
        <label key={interest} className="archived-toggle">
          <input
            type="checkbox"
            checked={value.includes(interest)}
            onChange={() =>
              onChange(value.includes(interest) ? value.filter((v) => v !== interest) : [...value, interest])
            }
          />
          {interest}
        </label>
      ))}
    </fieldset>
  );
}

/** The photo with the page outlined, and a handle on each corner - dragged, or moved with the arrow keys. */
function PageCorners({ src, corners, onMove }) {
  const boxRef = useRef(null);
  const dragging = useRef(null);

  function pointAt(e) {
    const rect = boxRef.current.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
  }

  function nudge(e, index) {
    const step = e.shiftKey ? 0.02 : 0.004;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    const corner = corners[index];
    onMove(index, { x: clamp(corner.x + delta[0]), y: clamp(corner.y + delta[1]) });
  }

  const outline = corners.map((c) => `${c.x},${c.y}`).join(" L ");

  return (
    <div className="paper-photo" ref={boxRef}>
      <img src={src} alt="Photo of the paper waiver" draggable={false} />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {/* Shade what the crop removes. */}
        <path className="paper-photo-outside" d={`M0,0 H1 V1 H0 Z M ${outline} Z`} fillRule="evenodd" />
        <path className="paper-photo-page" d={`M ${outline} Z`} />
      </svg>
      {corners.map((corner, index) => (
        <button
          key={CORNER_NAMES[index]}
          type="button"
          className="paper-corner"
          style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
          aria-label={`${CORNER_NAMES[index]} corner of the page`}
          onPointerDown={(e) => {
            dragging.current = index;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragging.current === index) onMove(index, pointAt(e));
          }}
          onPointerUp={() => {
            dragging.current = null;
          }}
          onPointerCancel={() => {
            dragging.current = null;
          }}
          onKeyDown={(e) => nudge(e, index)}
        />
      ))}
    </div>
  );
}
