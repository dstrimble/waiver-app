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
import { buildFollowUpEmail, buildGymEmail, buildMemberEmail } from "../src/waiverEmails.js";
import { getFollowUpConfig, sendDueFollowUps } from "../src/followUpEmails.js";
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

// The route emails after responding, and rendering the PDF first takes several
// ticks, so a single flush races the notification. Poll for the effect instead.
async function waitFor(label, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
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

  it("waiver text covers recording and is versioned past v1", async () => {
    const { WAIVER_TEXT_VERSION: version, WAIVER_PARAGRAPHS: paragraphs } =
      await vi.importActual("../src/waiverText.js");

    const recording = paragraphs.find((p) => /Recording of training/.test(p));
    expect(recording).toBeDefined();
    expect(recording).toMatch(/consent to being recorded/i);
    // Scoped to member review: promotional use is explicitly carved out.
    expect(recording).toMatch(/not be used for advertising, marketing/i);
    expect(recording).toMatch(/do not wish to be recorded/i);

    // Rows signed under the old copy must stay distinguishable from these.
    expect(version).not.toBe("v1");
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
    await waitFor("both emails to be sent", () => sendMailMock.mock.calls.length === 2);

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
    const findUpdate = () =>
      queryMock.mock.calls.find(([sql]) => sql.includes("notification_error"));
    await waitFor("the failure to be recorded", () => Boolean(findUpdate()));

    // The failure is recorded on the row instead of failing the submission.
    const update = findUpdate();
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

describe("one-week follow-up email", () => {
  const CONFIG = {
    gymName: "Gravitas Mixed Martial Arts",
    gymShortName: "Gravitas",
    notifyEmail: "gravitasmma@gmail.com",
    signupUrl: "https://example.com/join",
    accountPortalUrl: "https://example.com/account",
    scheduleUrl: "https://example.com/schedule",
    phone: "501-497-5811",
    websiteUrl: "https://www.gravitasmartialarts.com/",
  };

  const KEYS = [
    "FOLLOWUP_ENABLED",
    "FOLLOWUP_DELAY_DAYS",
    "FOLLOWUP_GRACE_DAYS",
    "FOLLOWUP_POLL_MINUTES",
    "FOLLOWUP_BATCH_SIZE",
  ];

  beforeEach(() => {
    for (const key of KEYS) delete process.env[key];
    queryMock.mockReset();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: "<abc@local>", accepted: [], rejected: [] });
  });

  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  it("asks about the trial week and repeats the confirmation email's links", () => {
    const email = buildFollowUpEmail(SUBMISSION, CONFIG);

    expect(email.subject).toBe("How was your free trial week at Gravitas?");
    expect(email.text).toContain("How did you enjoy your free trial week at Gravitas?");
    expect(email.text).toContain("Sign up is easy!");
    expect(email.text).toContain("fitness journey");
    expect(email.text).toContain("Hi Jane,");

    // Every link the confirmation email offers is offered again here.
    const confirmation = buildMemberEmail(SUBMISSION, CONFIG);
    for (const url of [CONFIG.signupUrl, CONFIG.accountPortalUrl, CONFIG.scheduleUrl]) {
      expect(confirmation.text).toContain(url);
      expect(email.text).toContain(url);
      expect(email.html).toContain(`href="${url}"`);
    }
    expect(email.text).toContain("Phone: 501-497-5811");
  });

  it("falls back to the full gym name and website when the extras are unset", () => {
    const email = buildFollowUpEmail(SUBMISSION, {
      gymName: "Gravitas Mixed Martial Arts",
      websiteUrl: "https://www.gravitasmartialarts.com/",
    });

    expect(email.subject).toContain("Gravitas Mixed Martial Arts");
    expect(email.text).toMatch(/visit https:\/\/www\.gravitasmartialarts\.com\//);
  });

  it("escapes guest-supplied names", () => {
    const email = buildFollowUpEmail({ ...SUBMISSION, name: '<script>x</script>' }, CONFIG);

    expect(email.html).not.toContain("<script>");
  });

  it("claims waivers due a week ago and emails each one", async () => {
    queryMock.mockImplementation((sql) => {
      if (sql.includes("RETURNING w.id")) {
        return Promise.resolve({
          rows: [
            { id: 21, name: "Jane Doe", email: "jane@example.com" },
            { id: 22, name: "Sam Roe", email: "sam@example.com" },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await sendDueFollowUps();

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(sendMailMock.mock.calls.map(([m]) => m.to)).toEqual([
      "jane@example.com",
      "sam@example.com",
    ]);
    // A nudge, not a records copy - the PDF only ships with the confirmation.
    for (const [message] of sendMailMock.mock.calls) {
      expect(message.attachments).toBeUndefined();
    }

    // Claim window: due at 7 days, given up on after the 3-day grace period.
    const [claimSql, claimParams] = queryMock.mock.calls[0];
    expect(claimParams).toEqual([7, 10, 50]);
    // Waivers signed before the feature shipped are never picked up.
    expect(claimSql).toMatch(/AND followup_eligible/);
  });

  it("releases the claim so a failed send is retried next sweep", async () => {
    queryMock.mockImplementation((sql) => {
      if (sql.includes("RETURNING w.id")) {
        return Promise.resolve({ rows: [{ id: 23, name: "Jane Doe", email: "jane@example.com" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    sendMailMock.mockRejectedValue(new Error("smtp is down"));

    const result = await sendDueFollowUps();

    expect(result).toEqual({ sent: 0, failed: 1 });
    const release = queryMock.mock.calls.find(([sql]) =>
      sql.includes("followup_sent_at = NULL")
    );
    expect(release).toBeDefined();
    expect(release[1]).toEqual([23, "smtp is down"]);
  });

  it("sends nothing when disabled", async () => {
    process.env.FOLLOWUP_ENABLED = "false";

    const result = await sendDueFollowUps();

    expect(result.skipped).toBe(true);
    expect(queryMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("honors a custom delay and grace window", () => {
    process.env.FOLLOWUP_DELAY_DAYS = "14";
    process.env.FOLLOWUP_GRACE_DAYS = "1";

    expect(getFollowUpConfig()).toMatchObject({
      enabled: true,
      delayDays: 14,
      graceDays: 1,
    });
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
