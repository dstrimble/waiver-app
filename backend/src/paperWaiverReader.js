import Anthropic from "@anthropic-ai/sdk";
import { INTERESTS } from "./waiverSubmission.js";

// Reads a photo of a paper waiver with Claude: what is written on it, in the
// online form's fields, and where the page's corners are so the photo can be
// cropped to the paper. Nothing read here is saved as-is - a person checks
// and corrects it on the admin page first.

const MODEL = "claude-opus-5";
// Cloudflare gives up on a request after 100 seconds.
const TIMEOUT_MS = 90_000;
// The API's limit for one base64 image.
const MAX_IMAGE_CHARS = 5 * 1024 * 1024;

const SIGNER_FIELDS = [
  "name", "email", "address", "city", "state", "zip", "cellPhone", "homePhone",
  "otherGymMember", "membershipExpires", "heardAbout", "lookingFor",
];
const CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"];

const text = { type: "string" };
const point = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: { x: { type: "number" }, y: { type: "number" } },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["signer", "participants", "signedOn", "signed", "notes", "corners"],
  properties: {
    signer: {
      type: "object",
      additionalProperties: false,
      required: SIGNER_FIELDS,
      properties: Object.fromEntries(SIGNER_FIELDS.map((field) => [field, text])),
    },
    participants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "dateOfBirth", "interests", "isSigner"],
        properties: {
          name: text,
          dateOfBirth: text,
          interests: { type: "array", items: { type: "string", enum: INTERESTS } },
          isSigner: { type: "boolean" },
        },
      },
    },
    signedOn: text,
    signed: { type: "boolean" },
    notes: text,
    corners: {
      type: "object",
      additionalProperties: false,
      required: CORNERS,
      properties: Object.fromEntries(CORNERS.map((corner) => [corner, point])),
    },
  },
};

const SYSTEM = `You read photos of the paper waiver guests sign at a martial arts gym, so staff don't have to type them in. Transcribe what is written on the page into the fields of the gym's online waiver form. A person checks and corrects everything before it is saved, so transcribe faithfully rather than guess: use an empty string for anything blank or unreadable, and use notes to point out whatever they should double-check.

- signer: the adult who signed. When a parent or guardian signed for a child, the signer is the parent. email, address, city, state (two letters), zip, cellPhone, homePhone, otherGymMember (whether they belong to another gym), membershipExpires (when that membership ends), heardAbout (how they heard about the gym), lookingFor (what they want in a club).
- participants: everyone who will train. A signer who trains too is listed with isSigner true and the signer's name; a child signed for by a parent has isSigner false. dateOfBirth is YYYY-MM-DD; handwritten dates are US month/day/year. interests are the classes ticked or circled.
- signedOn: the date written by the signature, YYYY-MM-DD.
- signed: whether the page carries a handwritten signature.
- corners: the four corners of the sheet of paper, in pixel coordinates of this image, so the photo can be cropped to just the page. If a corner is out of frame, give the nearest point on the edge of the image.`;

export class PaperReadError extends Error {}

export function isPaperReaderConfigured() {
  return Boolean(String(process.env.ANTHROPIC_API_KEY || "").trim());
}

/** `{mediaType, data}` from a JPEG, PNG or WebP data URL, or null. */
export function parseImageDataUrl(value) {
  const match = String(value || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[2].length > MAX_IMAGE_CHARS) return null;
  return { mediaType: match[1], data: match[2] };
}

function trimmed(value) {
  return String(value ?? "").trim();
}

function dateOrBlank(value) {
  const date = trimmed(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function clamp01(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * @param {{mediaType: string, data: string, width: number, height: number}} photo
 * @returns {Promise<{signer: object, participants: object[], signedOn: string, signed: boolean, notes: string, corners: {x: number, y: number}[]}>}
 *   Corners run top-left, top-right, bottom-right, bottom-left, as fractions of the image.
 */
export async function readPaperWaiver({ mediaType, data, width, height }) {
  const client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // On a refusal, the API retries on the model Anthropic recommends for it.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data } },
          { type: "text", text: `Read this waiver. The image is ${width}x${height} pixels.` },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new PaperReadError("Claude would not read this photo.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new PaperReadError("Claude could not finish reading this photo.");
  }

  let reading;
  try {
    reading = JSON.parse(response.content.find((block) => block.type === "text")?.text || "");
  } catch {
    throw new PaperReadError("Claude's reading of this photo could not be understood.");
  }

  const allowed = new Set(INTERESTS);
  return {
    signer: Object.fromEntries(SIGNER_FIELDS.map((field) => [field, trimmed(reading.signer?.[field])])),
    participants: (Array.isArray(reading.participants) ? reading.participants : []).map((person) => ({
      name: trimmed(person.name),
      dateOfBirth: dateOrBlank(person.dateOfBirth),
      interests: (Array.isArray(person.interests) ? person.interests : []).filter((i) => allowed.has(i)),
      isSigner: person.isSigner === true,
    })),
    signedOn: dateOrBlank(reading.signedOn),
    signed: reading.signed === true,
    notes: trimmed(reading.notes),
    corners: CORNERS.map((corner) => ({
      x: clamp01(reading.corners?.[corner]?.x / width),
      y: clamp01(reading.corners?.[corner]?.y / height),
    })),
  };
}
