import { Router } from "express";
import { pool } from "../db.js";
import { sendWaiverNotifications } from "../waiverNotifier.js";
import {
  WAIVER_ACCEPTANCE_STATEMENT,
  WAIVER_PARAGRAPHS,
  WAIVER_TEXT_VERSION,
} from "../waiverText.js";

export const waiversRouter = Router();

const ALLOWED_INTERESTS = new Set(["BJJ", "Kickboxing", "MMA", "Kids Classes"]);

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

waiversRouter.post("/", async (req, res) => {
  const interests = Array.isArray(req.body?.interests)
    ? req.body.interests
        .map((v) => String(v || "").trim())
        .filter((v) => ALLOWED_INTERESTS.has(v))
    : [];

  const name = clean(req.body?.name);
  const parentName = clean(req.body?.parentName);
  const address = clean(req.body?.address);
  const city = clean(req.body?.city);
  const state = clean(req.body?.state);
  const zip = clean(req.body?.zip);
  const cellPhone = clean(req.body?.cellPhone);
  const homePhone = clean(req.body?.homePhone);
  const email = clean(req.body?.email);
  const dateOfBirth = clean(req.body?.dateOfBirth);
  const otherGymMember = clean(req.body?.otherGymMember);
  const membershipExpires = clean(req.body?.membershipExpires);
  const heardAbout = clean(req.body?.heardAbout);
  const lookingFor = clean(req.body?.lookingFor);
  const accepted = req.body?.accepted === true;
  const signatureName = clean(req.body?.signatureName);
  const signatureDataUrl = clean(req.body?.signatureDataUrl);

  if (!name) return res.status(400).json({ error: "Name is required." });
  if (!email) return res.status(400).json({ error: "Email is required." });
  if (!isDateOnly(dateOfBirth)) {
    return res.status(400).json({ error: "Date of birth must be YYYY-MM-DD." });
  }
  if (!accepted) {
    return res.status(400).json({ error: "Waiver acceptance is required." });
  }
  if (!signatureName) {
    return res.status(400).json({ error: "Signature name is required." });
  }
  if (!signatureDataUrl || !signatureDataUrl.startsWith("data:image/png;base64,")) {
    return res.status(400).json({ error: "A drawn signature is required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO waiver_submissions (
        interests, name, parent_name, address, city, state, zip,
        cell_phone, home_phone, email, date_of_birth, other_gym_member,
        membership_expires, heard_about, looking_for,
        waiver_text_version, accepted, signature_name, signature_data_url
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19
      ) RETURNING id, submitted_at`,
      [
        interests,
        name,
        parentName,
        address,
        city,
        state,
        zip,
        cellPhone,
        homePhone,
        email,
        dateOfBirth,
        otherGymMember,
        membershipExpires,
        heardAbout,
        lookingFor,
        WAIVER_TEXT_VERSION,
        accepted,
        signatureName,
        signatureDataUrl,
      ]
    );

    const { id, submitted_at: submittedAt } = result.rows[0];

    // Emailing the PDF happens after the waiver is safely stored, and its
    // outcome is recorded on the row rather than failing the submission.
    sendWaiverNotifications({
      id,
      submittedAt,
      interests,
      name,
      parentName,
      address,
      city,
      state,
      zip,
      cellPhone,
      homePhone,
      email,
      dateOfBirth,
      otherGymMember,
      membershipExpires,
      heardAbout,
      lookingFor,
      waiverTextVersion: WAIVER_TEXT_VERSION,
      accepted,
      signatureName,
      signatureDataUrl,
    }).catch((err) => {
      console.error("Unexpected waiver notification error:", err);
    });

    return res.status(201).json({
      id,
      submittedAt,
      message: "Waiver submitted successfully.",
    });
  } catch (err) {
    console.error("Failed to save waiver:", err);
    return res.status(500).json({ error: "Could not save waiver." });
  }
});
