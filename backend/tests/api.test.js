import request from "supertest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.fn();
const sendMailMock = vi.fn();

vi.mock("../src/db.js", () => ({
  pool: {
    query: (...args) => queryMock(...args),
  },
}));

vi.mock("../src/mailer.js", () => ({
  isMailerConfigured: () => true,
  sendMail: (...args) => sendMailMock(...args),
  getMailerConfig: () => ({ enabled: true }),
  resetMailerTransport: () => {},
}));

import { createApp } from "../src/app.js";
import { renderWaiverPdf, waiverPdfFilename } from "../src/waiverPdf.js";
import { buildGymEmail, buildMemberEmail } from "../src/waiverEmails.js";
import { WAIVER_PARAGRAPHS, WAIVER_TEXT_VERSION } from "../src/waiverText.js";

// 1x1 transparent PNG - a valid stand-in for a drawn signature.
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SUBMISSION = {
  id: 7,
  submittedAt: "2026-07-23T00:00:00.000Z",
  interests: ["BJJ"],
  name: "Jane Doe",
  email: "jane@example.com",
  dateOfBirth: "2000-01-01",
  waiverTextVersion: WAIVER_TEXT_VERSION,
  accepted: true,
  signatureName: "Jane Doe",
  signatureDataUrl: SIGNATURE_PNG,
};

// The route emails after responding, so tests wait for those sends to land.
function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("waiver api", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: "<abc@local>", accepted: [], rejected: [] });
    process.env.ADMIN_PASSCODE = "changeme";
    process.env.WAIVER_NOTIFY_EMAIL = "gravitasmma@gmail.com";
  });

  afterEach(() => {
    delete process.env.SIGNUP_URL;
    delete process.env.ACCOUNT_PORTAL_URL;
  });

  it("GET /healthz returns ok", async () => {
    const res = await request(createApp()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("POST /api/waivers rejects missing signature", async () => {
    const res = await request(createApp()).post("/api/waivers").send({
      name: "Test",
      email: "test@example.com",
      accepted: true,
      signatureName: "Test",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/drawn signature/i);
  });

  it("POST /api/waivers stores valid payload", async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 1, submitted_at: "2026-07-23T00:00:00.000Z" }] });

    const res = await request(createApp()).post("/api/waivers").send({
      interests: ["BJJ", "MMA"],
      name: "Jane Doe",
      email: "jane@example.com",
      dateOfBirth: "2000-01-01",
      accepted: true,
      signatureName: "Jane Doe",
      signatureDataUrl: SIGNATURE_PNG,
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);

    const [, insertParams] = queryMock.mock.calls[0];
    expect(insertParams).toContain(WAIVER_TEXT_VERSION);
  });

  it("GET /api/waivers/text serves the waiver copy the PDF uses", async () => {
    const res = await request(createApp()).get("/api/waivers/text");

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(WAIVER_TEXT_VERSION);
    expect(res.body.paragraphs).toEqual(WAIVER_PARAGRAPHS);
    expect(res.body.acceptanceStatement).toMatch(/read and agree/i);
  });

  it("POST /api/waivers emails the PDF to the gym and the signer", async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 9, submitted_at: "2026-07-23T00:00:00.000Z" }] });

    const res = await request(createApp()).post("/api/waivers").send({
      interests: ["BJJ"],
      name: "Jane Doe",
      email: "jane@example.com",
      dateOfBirth: "2000-01-01",
      accepted: true,
      signatureName: "Jane Doe",
      signatureDataUrl: SIGNATURE_PNG,
    });

    expect(res.status).toBe(201);
    await flushAsync();

    expect(sendMailMock).toHaveBeenCalledTimes(2);
    const recipients = sendMailMock.mock.calls.map(([message]) => message.to);
    expect(recipients).toContain("gravitasmma@gmail.com");
    expect(recipients).toContain("jane@example.com");

    for (const [message] of sendMailMock.mock.calls) {
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].contentType).toBe("application/pdf");
      expect(message.attachments[0].content.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("POST /api/waivers still succeeds when email delivery fails", async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 10, submitted_at: "2026-07-23T00:00:00.000Z" }] });
    sendMailMock.mockRejectedValue(new Error("smtp is down"));

    const res = await request(createApp()).post("/api/waivers").send({
      name: "Jane Doe",
      email: "jane@example.com",
      accepted: true,
      signatureName: "Jane Doe",
      signatureDataUrl: SIGNATURE_PNG,
    });

    expect(res.status).toBe(201);
    await flushAsync();

    // The failure is recorded on the row instead of failing the submission.
    const update = queryMock.mock.calls.find(([sql]) => sql.includes("notification_error"));
    expect(update).toBeDefined();
    expect(update[1][2]).toMatch(/smtp is down/);
  });

  it("POST /api/admin/verify unlocks with correct passcode", async () => {
    const res = await request(createApp())
      .post("/api/admin/verify")
      .set("x-admin-passcode", "changeme");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("renders a signed waiver PDF with a stable filename", async () => {
    const pdf = await renderWaiverPdf(SUBMISSION);

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
    expect(waiverPdfFilename(SUBMISSION)).toBe("waiver-jane-doe-2026-07-23.pdf");
  });

  it("renders a PDF even when the signature image is unusable", async () => {
    const pdf = await renderWaiverPdf({ ...SUBMISSION, signatureDataUrl: "not-an-image" });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("member email includes configured account links and omits unset ones", () => {
    const config = {
      gymName: "Gravitas MMA",
      notifyEmail: "gravitasmma@gmail.com",
      signupUrl: "https://example.com/join",
      accountPortalUrl: "",
      scheduleUrl: "",
    };
    const email = buildMemberEmail(SUBMISSION, config);

    expect(email.subject).toMatch(/Gravitas MMA/);
    expect(email.text).toContain("https://example.com/join");
    expect(email.html).toContain("https://example.com/join");
    expect(email.text).not.toContain("Manage your account");
  });

  it("member email points at the website when no links are configured", () => {
    const email = buildMemberEmail(SUBMISSION, {
      gymName: "Gravitas MMA",
      notifyEmail: "gravitasmma@gmail.com",
      websiteUrl: "https://www.gravitasmartialarts.com/",
    });

    expect(email.text).toMatch(/visit https:\/\/www\.gravitasmartialarts\.com\//);
    expect(email.text).not.toMatch(/front desk/i);
    expect(email.html).toContain('href="https://www.gravitasmartialarts.com/"');
  });

  it("defaults the sign-up link so the member email always has one", async () => {
    const { getSiteConfig } = await vi.importActual("../src/siteConfig.js");
    delete process.env.SIGNUP_URL;

    const config = getSiteConfig();
    expect(config.signupUrl).toBe("https://www.gravitasmartialarts.com/member-areas-4");

    const email = buildMemberEmail(SUBMISSION, config);
    expect(email.text).toContain("member-areas-4");
  });

  it("gym email summarizes the submission", () => {
    const email = buildGymEmail(SUBMISSION, { gymName: "Gravitas MMA" });

    expect(email.subject).toBe("New waiver: Jane Doe");
    expect(email.text).toContain("jane@example.com");
    expect(email.html).toContain("Jane Doe");
  });

  it("escapes HTML in guest-supplied values", () => {
    const email = buildGymEmail(
      { ...SUBMISSION, name: '<script>alert("x")</script>' },
      { gymName: "Gravitas MMA" }
    );

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("GET /api/admin/waivers accepts date range filters", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await request(createApp())
      .get("/api/admin/waivers?start=2026-07-01&end=2026-07-31")
      .set("x-admin-passcode", "changeme");

    expect(res.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual(["2026-07-01", "2026-07-31"]);
  });

  it("POST /api/admin/change-passcode updates DB-backed passcode", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ password_hash: "salt:deadbeef" }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(createApp())
      .post("/api/admin/change-passcode")
      .set("x-admin-passcode", "changeme")
      .send({
        currentPasscode: "changeme",
        newPasscode: "newpass123",
        confirmPasscode: "newpass123",
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(queryMock).toHaveBeenCalled();
  });
});

// The real mailer, unmocked, so its SMTP config handling is actually exercised.
describe("smtp mailer config", () => {
  const KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_STARTTLS"];
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("is disabled until both host and sender are set", async () => {
    const mailer = await vi.importActual("../src/mailer.js");

    expect(mailer.isMailerConfigured()).toBe(false);
    process.env.SMTP_HOST = "smtp.gmail.com";
    expect(mailer.isMailerConfigured()).toBe(false);
    process.env.SMTP_FROM = "Gravitas <gravitasmma@gmail.com>";
    expect(mailer.isMailerConfigured()).toBe(true);
  });

  it("defaults to port 587 with STARTTLS", async () => {
    const mailer = await vi.importActual("../src/mailer.js");
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_FROM = "a@b.com";

    const config = mailer.getMailerConfig();
    expect(config.port).toBe(587);
    expect(config.startTls).toBe(true);
  });

  it("honors SMTP_STARTTLS=false and an explicit port", async () => {
    const mailer = await vi.importActual("../src/mailer.js");
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_FROM = "a@b.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_STARTTLS = "false";

    const config = mailer.getMailerConfig();
    expect(config.port).toBe(465);
    expect(config.startTls).toBe(false);
  });

  it("refuses to send when unconfigured", async () => {
    const mailer = await vi.importActual("../src/mailer.js");
    await expect(mailer.sendMail({ to: "a@b.com", subject: "s", text: "t" })).rejects.toThrow(
      /SMTP is not configured/
    );
  });
});
