import crypto from "crypto";
import { Router } from "express";
import { pool } from "../db.js";
import { sendWaiverNotifications } from "../waiverNotifier.js";
import { syncNewWaiver } from "../matTracker.js";
import {
  WAIVER_ACCEPTANCE_STATEMENT,
  WAIVER_PARAGRAPHS,
  WAIVER_TEXT_VERSION,
} from "../waiverText.js";

export const waiversRouter = Router();

const ALLOWED_INTERESTS = new Set(["BJJ", "Kickboxing", "MMA", "Kids Classes"]);

// A parent and their children fit comfortably; a bigger list is a mistake.
const MAX_PARTICIPANTS = 10;

// Nobody younger can sign for themselves, and nobody this age or older can be
// signed for by someone else.
const AGE_OF_MAJORITY = 18;

// The public form renders this so the on-screen copy and the emailed PDF can
// never drift apart.
waiversRouter.get("/text", (_req, res) => {
  return res.json({
    version: WAIVER_TEXT_VERSION,
    paragraphs: WAIVER_PARAGRAPHS,
    acceptanceStatement: WAIVER_ACCEPTANCE_STATEMENT,
  });
});

function clean(value) {
  const result = String(value || "").trim();
  return result || null;
}

function isDateOnly(value) {
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
function readSubmission(body = {}) {
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

function problemWith({ signer, participants }, { accepted, signatureName, signatureDataUrl }) {
  if (!signer.name) return "Name is required.";
  if (!signer.email) return "Email is required.";
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

  if (!accepted) return "Waiver acceptance is required.";
  if (!signatureName) return "Signature name is required.";
  if (!signatureDataUrl || !signatureDataUrl.startsWith("data:image/png;base64,")) {
    return "A drawn signature is required.";
  }
  return null;
}

const COLUMNS = [
  "submission_id", "interests", "name", "parent_name", "address", "city", "state", "zip",
  "cell_phone", "home_phone", "email", "date_of_birth", "other_gym_member",
  "membership_expires", "heard_about", "looking_for",
  "waiver_text_version", "accepted", "signature_name", "signature_data_url",
];

waiversRouter.post("/", async (req, res) => {
  const { signer, participants } = readSubmission(req.body);
  const accepted = req.body?.accepted === true;
  const signatureName = clean(req.body?.signatureName);
  const signatureDataUrl = clean(req.body?.signatureDataUrl);

  const problem = problemWith({ signer, participants }, { accepted, signatureName, signatureDataUrl });
  if (problem) return res.status(400).json({ error: problem });

  try {
    // Every person gets their own row, so the admin list, charts and
    // conversion stay per person. They share one submission id, the contact
    // details and the one signature, and go in with a single statement so a
    // family is stored whole or not at all.
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
        WAIVER_TEXT_VERSION,
        accepted,
        signatureName,
        signatureDataUrl,
      ];
      const placeholders = values.map((value) => {
        params.push(value);
        return `$${params.length}`;
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
    const submittedAt = result.rows[0].submitted_at;
    const people = participants.map((person, index) => ({ ...person, id: ids[index] ?? null }));

    // Emailing the PDF happens after the waiver is safely stored, and its
    // outcome is recorded on the rows rather than failing the submission.
    sendWaiverNotifications({
      id: ids[0],
      ids,
      submissionId,
      submittedAt,
      signerName: signer.name,
      participants: people,
      ...signer,
      name: signer.name,
      waiverTextVersion: WAIVER_TEXT_VERSION,
      accepted,
      signatureName,
      signatureDataUrl,
    }).catch((err) => {
      console.error("Unexpected waiver notification error:", err);
    });

    // Likewise the MatTracker account setup: one call for the whole family,
    // recorded on the rows, retried by a sweep if it fails.
    syncNewWaiver(
      people.map((person) => ({
        id: person.id,
        name: person.name,
        parent_name: person.isSigner ? null : signer.name,
        email: signer.email,
        submitted_at: submittedAt,
        submission_id: submissionId,
      }))
    );

    return res.status(201).json({
      id: ids[0],
      ids,
      submittedAt,
      message: "Waiver submitted successfully.",
    });
  } catch (err) {
    console.error("Failed to save waiver:", err);
    return res.status(500).json({ error: "Could not save waiver." });
  }
});
