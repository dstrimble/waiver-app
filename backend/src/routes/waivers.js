import { Router } from "express";
import { clean, problemWithPeople, readSubmission, recordWaiver } from "../waiverSubmission.js";
import {
  WAIVER_ACCEPTANCE_STATEMENT,
  WAIVER_PARAGRAPHS,
  WAIVER_TEXT_VERSION,
} from "../waiverText.js";

export const waiversRouter = Router();

// The public form renders this so the on-screen copy and the emailed PDF can
// never drift apart.
waiversRouter.get("/text", (_req, res) => {
  return res.json({
    version: WAIVER_TEXT_VERSION,
    paragraphs: WAIVER_PARAGRAPHS,
    acceptanceStatement: WAIVER_ACCEPTANCE_STATEMENT,
  });
});

function problemWithSignature({ accepted, signatureName, signatureDataUrl }) {
  if (!accepted) return "Waiver acceptance is required.";
  if (!signatureName) return "Signature name is required.";
  if (!signatureDataUrl || !signatureDataUrl.startsWith("data:image/png;base64,")) {
    return "A drawn signature is required.";
  }
  return null;
}

waiversRouter.post("/", async (req, res) => {
  const { signer, participants } = readSubmission(req.body);
  const accepted = req.body?.accepted === true;
  const signatureName = clean(req.body?.signatureName);
  const signatureDataUrl = clean(req.body?.signatureDataUrl);

  const problem =
    problemWithPeople({ signer, participants }) ||
    problemWithSignature({ accepted, signatureName, signatureDataUrl });
  if (problem) return res.status(400).json({ error: problem });

  try {
    const { ids, submittedAt } = await recordWaiver({
      signer,
      participants,
      accepted,
      signatureName,
      signatureDataUrl,
      waiverTextVersion: WAIVER_TEXT_VERSION,
    });

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
