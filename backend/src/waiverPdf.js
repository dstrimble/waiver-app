import PDFDocument from "pdfkit";
import {
  WAIVER_ACCEPTANCE_STATEMENT,
  WAIVER_PARAGRAPHS,
  WAIVER_TEXT_VERSION,
} from "./waiverText.js";
import { joinNames, participantsOf, referencesOf, signerNameOf } from "./waiverPeople.js";

const MARGIN = 54;
const INK = "#111111";
const MUTED = "#555555";
const RULE = "#cccccc";

function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleString("en-US", {
    timeZone: process.env.DISPLAY_TIMEZONE || "America/New_York",
    dateStyle: "long",
    timeStyle: "short",
  });
}

function formatDateOnly(value) {
  if (!value) return "";
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value);
  const [, year, month, day] = match;
  return `${month}/${day}/${year}`;
}

function decodeSignature(dataUrl) {
  const raw = String(dataUrl || "");
  const prefix = "data:image/png;base64,";
  if (!raw.startsWith(prefix)) return null;
  try {
    const buffer = Buffer.from(raw.slice(prefix.length), "base64");
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

function sectionHeading(doc, text) {
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(text);
  doc
    .moveTo(doc.x, doc.y + 3)
    .lineTo(doc.page.width - MARGIN, doc.y + 3)
    .strokeColor(RULE)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.6);
}

// Two-column label/value rows. Values wrap under their own column so long
// addresses do not run into the next field.
function fieldRows(doc, rows) {
  const labelWidth = 150;
  const valueWidth = doc.page.width - MARGIN * 2 - labelWidth;

  for (const [label, value] of rows) {
    const text = String(value ?? "").trim() || "-";
    const height = Math.max(
      doc.font("Helvetica-Bold").fontSize(10).heightOfString(label, { width: labelWidth }),
      doc.font("Helvetica").fontSize(10).heightOfString(text, { width: valueWidth })
    );

    if (doc.y + height > doc.page.height - MARGIN) doc.addPage();

    const top = doc.y;
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(MUTED)
      .text(label, MARGIN, top, { width: labelWidth });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(INK)
      .text(text, MARGIN + labelWidth, top, { width: valueWidth });

    doc.x = MARGIN;
    doc.y = top + height + 5;
  }
}

/**
 * Render a signed waiver as a PDF.
 *
 * @param {object} submission Row-shaped waiver data (camelCase).
 * @param {object} [options]
 * @param {string} [options.gymName]
 * @returns {Promise<Buffer>}
 */
export function renderWaiverPdf(submission, { gymName = "Gravitas Mixed Martial Arts" } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: MARGIN,
      info: {
        Title: `Waiver & Release - ${signerNameOf(submission) || "Guest"}`,
        Author: gymName,
        Subject: `Signed waiver (${submission.waiverTextVersion || WAIVER_TEXT_VERSION})`,
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(gymName);
      doc.font("Helvetica").fontSize(13).fillColor(MUTED).text("Waiver & Release");
      doc.moveDown(0.4);
      doc
        .fontSize(9)
        .fillColor(MUTED)
        .text(`Submitted: ${formatTimestamp(submission.submittedAt)}`)
        .text(
          `Reference: ${referencesOf(submission)}   |   Waiver text version: ${
            submission.waiverTextVersion || WAIVER_TEXT_VERSION
          }`
        );

      const people = participantsOf(submission);
      const signerName = signerNameOf(submission);
      const minors = people.filter((person) => !person.isSigner);
      const addressLine = [submission.address, submission.city, submission.state, submission.zip]
        .filter(Boolean)
        .join(", ");

      sectionHeading(doc, minors.length ? "Parent / Guardian" : "Guest Information");
      fieldRows(doc, [
        ["Name", signerName],
        ["Email", submission.email],
        ["Cell Phone", submission.cellPhone],
        ["Home Phone", submission.homePhone],
        ["Address", addressLine],
        ["Member At Another Gym", submission.otherGymMember],
        ["Membership Expires", submission.membershipExpires],
        ["Heard About Us", submission.heardAbout],
        ["Looking For In A Club", submission.lookingFor],
      ]);

      // Everyone the one signature covers, each with their own classes.
      sectionHeading(doc, people.length > 1 ? `Participants (${people.length})` : "Participant");
      people.forEach((person, index) => {
        if (index) doc.moveDown(0.5);
        fieldRows(doc, [
          ["Name", person.isSigner ? `${person.name} (signer)` : person.name],
          ["Date of Birth", formatDateOnly(person.dateOfBirth)],
          ["Interested In", (Array.isArray(person.interests) ? person.interests : []).join(", ")],
          ...(person.isSigner ? [] : [["Signed For By", `${signerName} (parent / guardian)`]]),
        ]);
      });

      sectionHeading(doc, "Waiver & Release");
      doc.font("Helvetica").fontSize(9.5).fillColor(INK);
      for (const paragraph of WAIVER_PARAGRAPHS) {
        doc.text(paragraph, { align: "justify", lineGap: 1.5 });
        doc.moveDown(0.7);
      }

      // Keep the heading, acceptance line and signature on one page.
      const signatureHeight = 70;
      const signatureBlockHeight = signatureHeight + 130;
      if (doc.y + signatureBlockHeight > doc.page.height - MARGIN) doc.addPage();

      sectionHeading(doc, "Acknowledgement & Signature");
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(INK)
        .text(
          `${submission.accepted ? "[X]" : "[ ]"} ${WAIVER_ACCEPTANCE_STATEMENT}`
        );
      if (minors.length) {
        doc.moveDown(0.4);
        doc.text(
          `Signed by ${signerName} as parent or legal guardian of ${joinNames(
            minors.map((person) => person.name)
          )}.`
        );
      }
      doc.moveDown(0.8);

      const signature = decodeSignature(submission.signatureDataUrl);
      if (signature) {
        const top = doc.y;
        doc.image(signature, MARGIN, top, { fit: [260, signatureHeight], align: "left" });
        doc.y = top + signatureHeight;
      } else {
        doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED).text("(signature image unavailable)");
      }

      doc
        .moveTo(MARGIN, doc.y + 2)
        .lineTo(MARGIN + 260, doc.y + 2)
        .strokeColor(RULE)
        .lineWidth(0.5)
        .stroke();
      doc.y += 8;
      doc.x = MARGIN;

      fieldRows(doc, [
        ["Signed By", submission.signatureName],
        ["Signed On", formatTimestamp(submission.submittedAt)],
      ]);

      doc.moveDown(1.5);
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(MUTED)
        .text(
          "This document is an electronic record of a waiver signed online. Retain it for your records.",
          { align: "center" }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function waiverPdfFilename(submission) {
  const slug = String(signerNameOf(submission) || "guest")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "guest";
  const stamp = new Date(submission.submittedAt || Date.now());
  const date = Number.isNaN(stamp.getTime())
    ? "unknown-date"
    : stamp.toISOString().slice(0, 10);
  return `waiver-${slug}-${date}.pdf`;
}
