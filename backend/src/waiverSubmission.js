import crypto from "crypto";
import { pool } from "./db.js";
import { sendWaiverNotifications } from "./waiverNotifier.js";
import { syncNewWaiver } from "./matTracker.js";

// Shared by the public form and by paper waivers entered on the admin page, so
// a waiver is checked, stored, emailed and sent to MatTracker the same way
// whichever way it was signed.

export const INTERESTS = ["BJJ", "Kickboxing", "MMA", "Kids Classes"];
const ALLOWED_INTERESTS = new Set(INTERESTS);

// A parent and their children fit comfortably; a bigger list is a mistake.
const MAX_PARTICIPANTS = 10;

// Nobody younger can sign for themselves, and nobody this age or older can be
// signed for by someone else.
const AGE_OF_MAJORITY = 18;

// Stored as waiver_text_version on paper waivers: the printed copy they signed
// is the record, not the online WAIVER_PARAGRAPHS.
export const PAPER_WAIVER_TEXT_VERSION = "paper";

// A cropped photo of a letter page is well under this; anything bigger is not one.
const MAX_SCAN_CHARS = 8 * 1024 * 1024;

export function clean(value) {
  const result = String(value || "").trim();
  return result || null;
}

export function isDateOnly(value) {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function cleanInterests(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v || "").trim()).filter((v) => ALLOWED_INTERESTS.has(v)))];
}

function ageOn(dateOfBirth, when) {
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  let age = when.getFullYear() - year;
  if (when.getMonth() + 1 < month || (when.getMonth() + 1 === month && when.getDate() < day)) age -= 1;
  return age;
}

function contactDetails(source = {}) {
  return {
    email: clean(source.email),
    address: clean(source.address),
    city: clean(source.city),
    state: clean(source.state),
    zip: clean(source.zip),
    cellPhone: clean(source.cellPhone),
    homePhone: clean(source.homePhone),
    otherGymMember: clean(source.otherGymMember),
    membershipExpires: clean(source.membershipExpires),
    heardAbout: clean(source.heardAbout),
    lookingFor: clean(source.lookingFor),
  };
}

/**
 * The form sends a signer - the adult signing, with the household's contact
 * details - and the people the waiver covers, the signer among them only if
 * they train too. A page loaded before family waivers shipped still posts the
 * one-person shape; that reads as one person who signed for themselves or,
 * with a parent's name, was signed for by that parent.
 */
export function readSubmission(body = {}) {
  if (body.signer || Array.isArray(body.participants)) {
    const signer = { name: clean(body.signer?.name), ...contactDetails(body.signer) };
    const participants = (Array.isArray(body.participants) ? body.participants : []).map((p) => {
      const isSigner = p?.isSigner === true;
      return {
        isSigner,
        name: isSigner ? signer.name : clean(p?.name),
        dateOfBirth: clean(p?.dateOfBirth),
        interests: cleanInterests(p?.interests),
      };
    });
    return { signer, participants };
  }

  const name = clean(body.name);
  const parentName = clean(body.parentName);
  return {
    signer: { name: parentName || name, ...contactDetails(body) },
    participants: [
      {
        isSigner: !parentName,
        name,
        dateOfBirth: clean(body.dateOfBirth),
        interests: cleanInterests(body.interests),
      },
    ],
  };
}

/**
 * What is wrong with who a waiver covers, or null. A paper waiver can be
 * stored without an email - the signed page is worth keeping even when the
 * guest left that line blank - and then only the gym is emailed.
 */
export function problemWithPeople({ signer, participants }, { emailRequired = true } = {}) {
  if (!signer.name) return "Name is required.";
  if (emailRequired && !signer.email) return "Email is required.";
  if (!participants.length) return "Add at least one person who will be training.";
  if (participants.length > MAX_PARTICIPANTS) {
    return `A waiver can cover at most ${MAX_PARTICIPANTS} people.`;
  }
  if (participants.filter((p) => p.isSigner).length > 1) return "The signer can only be listed once.";

  const today = new Date();
  for (const person of participants) {
    if (!person.name) return "Each person on the waiver needs a name.";
    if (!isDateOnly(person.dateOfBirth)) return "Date of birth must be YYYY-MM-DD.";
    if (!person.dateOfBirth) continue;
    const age = ageOn(person.dateOfBirth, today);
    if (person.isSigner && age < AGE_OF_MAJORITY) {
      return "Someone under 18 needs a parent or guardian to sign for them.";
    }
    if (!person.isSigner && age >= AGE_OF_MAJORITY) {
      return `${person.name} is 18 or over and needs to sign their own waiver.`;
    }
  }
  return null;
}

/** What is wrong with the paper-specific parts of a paper waiver, or null. */
export function problemWithPaper({ scanDataUrl, signedOn, confirmedSigned }) {
  if (!scanDataUrl || !/^data:image\/(jpeg|png);base64,/.test(scanDataUrl)) {
    return "Add the photo of the signed waiver.";
  }
  if (scanDataUrl.length > MAX_SCAN_CHARS) return "The photo of the waiver is too large.";
  if (!isDateOnly(signedOn)) return "Date signed must be YYYY-MM-DD.";
  if (signedOn && Date.parse(`${signedOn}T00:00:00Z`) > Date.now() + 86_400_000) {
    return "The date signed can't be in the future.";
  }
  if (!confirmedSigned) return "Check the paper waiver is signed before saving it.";
  return null;
}

/**
 * When a paper waiver counts as signed: midday UTC on the date written on it,
 * which is that same date across the Americas, and never later than now.
 * Without a date it is now.
 */
export function paperSignedAt(signedOn) {
  if (!signedOn) return null;
  return new Date(Math.min(Date.parse(`${signedOn}T12:00:00Z`), Date.now()));
}

const COLUMNS = [
  "submission_id", "interests", "name", "parent_name", "address", "city", "state", "zip",
  "cell_phone", "home_phone", "email", "date_of_birth", "other_gym_member",
  "membership_expires", "heard_about", "looking_for",
  "waiver_text_version", "accepted", "signature_name", "signature_data_url",
  "signed_on_paper", "submitted_at",
];

/**
 * Store a waiver, then email its PDF and set up MatTracker. Neither of those
 * can fail the save; their outcomes are recorded on the rows.
 *
 * @returns {Promise<{ids: string[], submissionId: string, submittedAt: Date}>}
 */
export async function recordWaiver({
  signer,
  participants,
  accepted,
  signatureName,
  signatureDataUrl,
  waiverTextVersion,
  signedOnPaper = false,
  submittedAt = null,
}) {
  // Every person gets their own row, so the admin list, charts and conversion
  // stay per person. They share one submission id, the contact details and the
  // one signature, and go in with a single statement so a family is stored
  // whole or not at all.
  const submissionId = crypto.randomUUID();
  const params = [];
  const tuples = participants.map((person) => {
    const values = [
      submissionId,
      person.interests,
      person.name,
      person.isSigner ? null : signer.name,
      signer.address,
      signer.city,
      signer.state,
      signer.zip,
      signer.cellPhone,
      signer.homePhone,
      signer.email,
      person.dateOfBirth,
      signer.otherGymMember,
      signer.membershipExpires,
      signer.heardAbout,
      signer.lookingFor,
      waiverTextVersion,
      accepted,
      signatureName,
      signatureDataUrl,
      signedOnPaper,
      submittedAt,
    ];
    const placeholders = values.map((value, index) => {
      params.push(value);
      const placeholder = `$${params.length}`;
      return COLUMNS[index] === "submitted_at" ? `COALESCE(${placeholder}::timestamptz, now())` : placeholder;
    });
    return `(${placeholders.join(", ")})`;
  });

  const result = await pool.query(
    `INSERT INTO waiver_submissions (${COLUMNS.join(", ")})
     VALUES ${tuples.join(", ")}
     RETURNING id, submitted_at`,
    params
  );

  const ids = result.rows.map((row) => row.id);
  const storedAt = result.rows[0].submitted_at;
  const people = participants.map((person, index) => ({ ...person, id: ids[index] ?? null }));

  sendWaiverNotifications({
    id: ids[0],
    ids,
    submissionId,
    submittedAt: storedAt,
    signerName: signer.name,
    participants: people,
    ...signer,
    name: signer.name,
    waiverTextVersion,
    accepted,
    signatureName,
    signatureDataUrl,
    signedOnPaper,
  }).catch((err) => {
    console.error("Unexpected waiver notification error:", err);
  });

  // One call for the whole family, recorded on the rows, retried by a sweep if
  // it fails.
  syncNewWaiver(
    people.map((person) => ({
      id: person.id,
      name: person.name,
      parent_name: person.isSigner ? null : signer.name,
      email: signer.email,
      submitted_at: storedAt,
      submission_id: submissionId,
    }))
  );

  return { ids, submissionId, submittedAt: storedAt };
}
