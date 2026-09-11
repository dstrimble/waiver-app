import crypto from "crypto";
import request from "supertest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.fn();
const sendMailMock = vi.fn();
const verifyIdTokenMock = vi.fn();

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken(...args) {
      return verifyIdTokenMock(...args);
    }
  },
}));

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
import { buildMemberStats } from "../src/memberStats.js";
import { buildSalesStats } from "../src/salesStats.js";
import { buildConversionStats } from "../src/conversionStats.js";
import { resetSquarespaceCache } from "../src/squarespace.js";

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
    // Nor are archived ones.
    expect(claimSql).toMatch(/archived_at IS NULL/);
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

describe("admin waiver actions", () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: "<abc@local>", accepted: [], rejected: [] });
    process.env.ADMIN_PASSCODE = "changeme";
  });

  const auth = (req) => req.set("x-admin-passcode", "changeme");

  it("archives a waiver without destroying the signed record", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 12, name: "Jane Doe", archived_at: new Date() }],
    });

    const res = await auth(request(createApp()).post("/api/admin/waivers/12/archive"));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const [sql, params] = queryMock.mock.calls[0];
    // A signed waiver is evidence: archiving must never issue a DELETE.
    expect(sql).not.toMatch(/DELETE/i);
    expect(sql).toMatch(/SET\s+archived_at = now\(\)/);
    expect(params).toEqual([12]);
  });

  it("restores an archived waiver by clearing the column", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 12, name: "Jane Doe", archived_at: null }] });

    const res = await auth(request(createApp()).post("/api/admin/waivers/12/restore"));

    expect(res.status).toBe(200);
    expect(res.body.archivedAt).toBeNull();
    expect(queryMock.mock.calls[0][0]).toMatch(/SET\s+archived_at = NULL/);
  });

  it("404s when archiving a waiver that is not there", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await auth(request(createApp()).post("/api/admin/waivers/999/archive"));

    expect(res.status).toBe(404);
  });

  it("rejects a non-numeric id", async () => {
    const res = await auth(request(createApp()).post("/api/admin/waivers/abc/archive"));

    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("hides archived waivers from the list unless asked", async () => {
    const app = createApp();
    queryMock.mockResolvedValue({ rows: [] });

    await auth(request(app).get("/api/admin/waivers"));
    expect(queryMock.mock.calls[0][0]).toMatch(/archived_at IS NULL/);

    queryMock.mockClear();
    await auth(request(app).get("/api/admin/waivers?includeArchived=true"));
    expect(queryMock.mock.calls[0][0]).not.toMatch(/archived_at IS NULL/);
  });

  it("refuses to send a follow-up for an archived waiver", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 13, email: "jane@example.com", followup_sent_at: null, archived_at: new Date() }],
    });

    const res = await auth(request(createApp()).post("/api/admin/waivers/13/followup"));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/archived/i);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("admin routes still require the passcode", async () => {
    const app = createApp();
    queryMock.mockResolvedValue({ rows: [] });

    const archive = await request(app).post("/api/admin/waivers/1/archive");
    const restore = await request(app).post("/api/admin/waivers/1/restore");
    const send = await request(app).post("/api/admin/waivers/1/followup");
    const stats = await request(app).get("/api/admin/stats");

    expect([archive.status, restore.status, send.status, stats.status]).toEqual([401, 401, 401, 401]);
  });

  it("POST /followup sends immediately and claims the row so the sweep will not", async () => {
    queryMock.mockImplementation((sql) => {
      if (sql.includes("SELECT id, email, followup_sent_at")) {
        return Promise.resolve({ rows: [{ id: 5, email: "jane@example.com", followup_sent_at: null, archived_at: null }] });
      }
      if (sql.includes("followup_sent_at = now()")) {
        return Promise.resolve({ rows: [{ id: 5, name: "Jane Doe", email: "jane@example.com" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await auth(request(createApp()).post("/api/admin/waivers/5/followup"));

    expect(res.status).toBe(200);
    expect(res.body.sentTo).toBe("jane@example.com");
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0].subject).toMatch(/free trial week/i);

    // The claim is what suppresses the automatic send a week later.
    const claim = queryMock.mock.calls.find(([sql]) => sql.includes("followup_sent_at = now()"));
    expect(claim[0]).toMatch(/followup_sent_at IS NULL/);
    expect(claim[1]).toEqual([5]);
  });

  it("POST /followup ignores the delay window and eligibility", async () => {
    queryMock.mockImplementation((sql) => {
      if (sql.includes("SELECT id, email, followup_sent_at")) {
        return Promise.resolve({ rows: [{ id: 6, email: "old@example.com", followup_sent_at: null, archived_at: null }] });
      }
      if (sql.includes("followup_sent_at = now()")) {
        return Promise.resolve({ rows: [{ id: 6, name: "Old Signer", email: "old@example.com" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await auth(request(createApp()).post("/api/admin/waivers/6/followup"));

    expect(res.status).toBe(200);
    // An admin pressing the button is not subject to submitted_at or eligibility.
    const claim = queryMock.mock.calls.find(([sql]) => sql.includes("followup_sent_at = now()"));
    expect(claim[0]).not.toMatch(/submitted_at/);
    expect(claim[0]).not.toMatch(/followup_eligible/);
  });

  it("POST /followup refuses to send a second copy", async () => {
    queryMock.mockImplementation((sql) => {
      if (sql.includes("SELECT id, email, followup_sent_at")) {
        return Promise.resolve({
          rows: [{ id: 7, email: "jane@example.com", followup_sent_at: new Date(), archived_at: null }],
        });
      }
      // The conditional claim matches nothing once the row is stamped.
      return Promise.resolve({ rows: [] });
    });

    const res = await auth(request(createApp()).post("/api/admin/waivers/7/followup"));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already been sent/i);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("POST /followup releases the claim when the send fails", async () => {
    queryMock.mockImplementation((sql) => {
      if (sql.includes("SELECT id, email, followup_sent_at")) {
        return Promise.resolve({ rows: [{ id: 8, email: "jane@example.com", followup_sent_at: null, archived_at: null }] });
      }
      if (sql.includes("followup_sent_at = now()")) {
        return Promise.resolve({ rows: [{ id: 8, name: "Jane Doe", email: "jane@example.com" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    sendMailMock.mockRejectedValue(new Error("smtp is down"));

    const res = await auth(request(createApp()).post("/api/admin/waivers/8/followup"));

    expect(res.status).toBe(502);
    // Released, so the weekly sweep can still try again.
    const release = queryMock.mock.calls.find(([sql]) => sql.includes("followup_sent_at = NULL"));
    expect(release[1]).toEqual([8, "smtp is down"]);
  });

  it("POST /followup 400s when the waiver has no email", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 9, email: null, followup_sent_at: null, archived_at: null }] });

    const res = await auth(request(createApp()).post("/api/admin/waivers/9/followup"));

    expect(res.status).toBe(400);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("GET /api/admin/stats aggregates without shipping signature images", async () => {
    queryMock.mockImplementation((sql) => {
      if (sql.includes("all_time")) {
        return Promise.resolve({
          rows: [{ all_time: 3, last_30: 2, last_7: 1, followups_sent: 1, followups_pending: 2 }],
        });
      }
      if (sql.includes("unnest(interests)")) {
        return Promise.resolve({ rows: [{ day: "2026-09-01", interest: "BJJ", count: 2 }] });
      }
      if (sql.includes("mode() WITHIN GROUP")) {
        return Promise.resolve({ rows: [{ label: "Facebook", count: 3 }] });
      }
      if (sql.includes("date_of_birth")) {
        return Promise.resolve({ rows: [{ band: "18-29", count: 3 }] });
      }
      if (sql.includes("isodow")) {
        return Promise.resolve({ rows: [{ dow: 1, count: 3 }] });
      }
      return Promise.resolve({ rows: [{ day: "2026-09-01", count: 3 }] });
    });

    const res = await auth(request(createApp()).get("/api/admin/stats"));

    expect(res.status).toBe(200);
    expect(res.body.totals.allTime).toBe(3);
    expect(res.body.daily).toEqual([{ day: "2026-09-01", count: 3 }]);
    // Fixed-order, zero-filled bands so the chart never invents a category.
    expect(res.body.ageBands.map((b) => b.band)).toEqual([
      "Under 13", "13-17", "18-29", "30-44", "45+", "Unknown",
    ]);
    expect(res.body.ageBands.find((b) => b.band === "13-17").count).toBe(0);
    expect(res.body.weekday).toHaveLength(7);
    expect(res.body.weekday[0]).toEqual({ label: "Mon", count: 3 });

    // No query may drag the base64 signature across the wire.
    for (const [sql] of queryMock.mock.calls) {
      expect(sql).not.toMatch(/signature_data_url/);
    }
  });
});

describe("squarespace members", () => {
  const NOW = Date.parse("2026-08-20T12:00:00Z");
  const opts = { now: NOW, timeZone: "UTC" };

  // Orders in the shape the Squarespace client hands over.
  function order(createdOn, items, extra = {}) {
    return {
      id: `${createdOn}-${extra.email || "pat"}`,
      createdOn: `${createdOn}T12:00:00Z`,
      email: "pat@example.com",
      name: "Pat Lee",
      paymentState: "PAID",
      items: items.map(([product, paid, type = "PAYWALL_PRODUCT", unitPrice = paid]) => ({
        product,
        type,
        unitPrice,
        quantity: 1,
        paid,
      })),
      ...extra,
    };
  }

  it("counts a member while renewals keep coming and drops them a week after one is missed", () => {
    const orders = ["2026-06-01", "2026-07-01", "2026-08-01"].map((d) =>
      order(d, [["Physical Membership", 100]])
    );

    const active = buildMemberStats(orders, opts);
    expect(active.totals.members).toBe(1);
    expect(active.current[0]).toMatchObject({
      name: "Pat Lee",
      plans: ["Physical Membership"],
      addChild: false,
      monthlyAmount: 100,
      memberSince: "2026-06-01T12:00:00.000Z",
    });

    // Last charge Aug 1 covers a month plus a week's grace - gone by Sep 9.
    const lapsed = buildMemberStats(orders, { ...opts, now: Date.parse("2026-09-09T12:00:00Z") });
    expect(lapsed.totals.members).toBe(0);
    expect(lapsed.totals.allTimeMembers).toBe(1);
  });

  it("tracks Add Child apart and never counts it as a member", () => {
    const orders = [
      order("2026-08-01", [["Physical Membership", 100]]),
      order("2026-08-01", [["Add Child", 25]]),
      order("2026-08-02", [["Add Child", 25]], { email: "sam@example.com", name: "Sam Roe" }),
    ];

    const stats = buildMemberStats(orders, opts);

    expect(stats.totals).toEqual({ members: 1, children: 2, allTimeMembers: 1 });
    const pat = stats.current.find((r) => r.email === "pat@example.com");
    expect(pat.plans).toEqual(["Physical Membership"]);
    expect(pat.addChild).toBe(true);
    const sam = stats.current.find((r) => r.email === "sam@example.com");
    expect(sam.plans).toEqual([]);
    expect(sam.memberSince).toBeNull();
    const august = stats.timeline[stats.timeline.length - 1];
    expect(august).toMatchObject({ month: "2026-08", members: 1, children: 2, partial: true });
  });

  it("treats a large charge as a year paid up front", () => {
    const stats = buildMemberStats([order("2026-01-15", [["Physical Membership", 1100]])], opts);

    expect(stats.totals.members).toBe(1);
    expect(stats.current[0]).toMatchObject({ annualAmount: 1100, monthlyAmount: 0 });
  });

  it("reports what members pay after discounts", () => {
    const discounted = order("2026-08-01", [["Physical Membership", 57.5, "PAYWALL_PRODUCT", 115]]);

    expect(buildMemberStats([discounted], opts).current[0].monthlyAmount).toBe(57.5);
  });

  it("ignores refunded charges", () => {
    const refunded = order("2026-08-01", [["Physical Membership", 100]], { paymentState: "REFUNDED" });

    const stats = buildMemberStats([refunded], opts);
    expect(stats.totals.allTimeMembers).toBe(0);
    expect(stats.current).toEqual([]);
  });

  it("counts a returning member as joining again", () => {
    const orders = ["2026-01-01", "2026-02-01", "2026-06-01", "2026-07-01", "2026-08-01"].map((d) =>
      order(d, [["Physical Membership", 100]])
    );

    const byMonth = Object.fromEntries(buildMemberStats(orders, opts).timeline.map((m) => [m.month, m]));

    expect(byMonth["2026-01"]).toMatchObject({ members: 1, joined: 1, left: 0 });
    // Feb 1's charge runs out in March.
    expect(byMonth["2026-03"]).toMatchObject({ members: 0, left: 1 });
    expect(byMonth["2026-04"]).toMatchObject({ members: 0, joined: 0 });
    expect(byMonth["2026-06"]).toMatchObject({ members: 1, joined: 1 });
  });
});

describe("squarespace sales", () => {
  const NOW = Date.parse("2026-08-20T12:00:00Z");

  function order(month, items, extra = {}) {
    return {
      id: `${month}-${items.length}`,
      createdOn: `${month}-10T12:00:00Z`,
      email: "",
      name: "",
      paymentState: "PAID",
      items: items.map(([product, type, paid]) => ({ product, type, unitPrice: paid, quantity: 1, paid })),
      ...extra,
    };
  }

  it("splits sales into memberships, retail and events by month", () => {
    const orders = [
      order("2026-06", [["Physical Membership", "PAYWALL_PRODUCT", 100]]),
      order("2026-08", [["Physical Membership", "PAYWALL_PRODUCT", 57.5]]),
      order("2026-08", [["Lifeaid beverage", "PHYSICAL_PRODUCT", 5]]),
      order("2026-08", [["Rank Review Tuesday Oct 10 @6pm", "SERVICE", 40]]),
      // Gear set up as a service is still retail.
      order("2026-08", [["Gravitas Shorts Pre-Order", "SERVICE", 30]]),
      order("2026-08", [["Unisex Hoodie", "PHYSICAL_PRODUCT", 999]], { paymentState: "REFUNDED" }),
    ];

    const sales = buildSalesStats(orders, { now: NOW, timeZone: "UTC" });

    // July had no sales but still gets a zero column.
    expect(sales.months.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(sales.months[1].total).toBe(0);
    expect(sales.months[2]).toMatchObject({
      memberships: 57.5,
      retail: 35,
      events: 40,
      total: 132.5,
      partial: true,
    });
    expect(sales.totals.thisMonth).toBe(132.5);
    expect(sales.totals.last12).toEqual({ memberships: 157.5, retail: 35, events: 40, total: 232.5 });
  });
});

describe("waivers to members", () => {
  const signer = (email, signedAt, followedUp = false) => ({
    email,
    signed_at: `${signedAt}T15:00:00Z`,
    followed_up: followedUp,
  });
  const charge = (email, day, product = "Physical Membership") => ({
    id: `${email}-${day}`,
    createdOn: `${day}T15:00:00Z`,
    email,
    name: "",
    paymentState: "PAID",
    items: [{ product, type: "PAYWALL_PRODUCT", unitPrice: 100, quantity: 1, paid: 100 }],
  });
  const opts = { timeZone: "UTC" };

  it("counts signers who went on to pay, and how long it took", () => {
    const stats = buildConversionStats(
      [
        signer("joined@example.com", "2026-07-01", true),
        signer("paid-first@example.com", "2026-07-10"),
        signer("never@example.com", "2026-08-02"),
      ],
      [
        charge("joined@example.com", "2026-07-15"),
        charge("joined@example.com", "2026-08-15"),
        // Paid a few hours before signing on the same visit - still a conversion.
        charge("paid-first@example.com", "2026-07-10"),
      ],
      opts
    );

    expect(stats).toMatchObject({ signers: 3, joined: 2, alreadyPaying: 0, medianDaysToJoin: 7 });
    expect(stats.rate).toBeCloseTo(2 / 3);
    expect(stats.byMonth).toEqual([
      { month: "2026-07", signers: 2, joined: 2, rate: 1 },
      { month: "2026-08", signers: 1, joined: 0, rate: 0 },
    ]);
    expect(stats.followUp.sent).toEqual({ signers: 1, joined: 1, rate: 1 });
    expect(stats.followUp.notSent).toEqual({ signers: 2, joined: 1, rate: 0.5 });
  });

  it("leaves out people who had paid before they signed", () => {
    const stats = buildConversionStats(
      [signer("member@example.com", "2026-07-01")],
      [charge("member@example.com", "2026-05-01"), charge("member@example.com", "2026-07-02")],
      opts
    );

    expect(stats).toMatchObject({ signers: 0, joined: 0, alreadyPaying: 1 });
  });

  it("counts a parent paying for Add Child as converting", () => {
    const stats = buildConversionStats(
      [signer("parent@example.com", "2026-07-01")],
      [charge("parent@example.com", "2026-07-03", "Add Child")],
      opts
    );

    expect(stats.joined).toBe(1);
  });
});

describe("GET /api/admin/members", () => {
  const auth = (req) => req.set("x-admin-passcode", "changeme");
  const recent = new Date(Date.now() - 5 * 86400000).toISOString();

  function rawOrder(id, extra = {}) {
    return {
      id,
      createdOn: recent,
      customerEmail: " Pat@Example.com ",
      billingAddress: { firstName: "Pat", lastName: "Lee", address1: "1 Main St" },
      paymentState: "PAID",
      testmode: false,
      subtotal: { value: "115.00" },
      discountTotal: { value: "57.50" },
      lineItems: [
        {
          productName: "Physical Membership",
          lineItemType: "PAYWALL_PRODUCT",
          unitPricePaid: { value: "115.00" },
          quantity: 1,
        },
      ],
      ...extra,
    };
  }

  const page = (result, nextPageCursor) => ({
    ok: true,
    json: () =>
      Promise.resolve({
        result,
        pagination: { hasNextPage: Boolean(nextPageCursor), nextPageCursor },
      }),
  });

  beforeEach(() => {
    resetSquarespaceCache();
    queryMock.mockReset();
    // The waiver signers matched against members.
    queryMock.mockResolvedValue({
      rows: [{ email: "pat@example.com", signed_at: new Date(Date.now() - 6 * 86400000), followed_up: true }],
    });
    process.env.ADMIN_PASSCODE = "changeme";
    process.env.SQUARESPACE_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.SQUARESPACE_API_KEY;
    vi.unstubAllGlobals();
  });

  it("requires the admin passcode", async () => {
    const res = await request(createApp()).get("/api/admin/members");

    expect(res.status).toBe(401);
  });

  it("says Squarespace is not connected when there is no key", async () => {
    delete process.env.SQUARESPACE_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await auth(request(createApp()).get("/api/admin/members"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pages through every order, keeps only what the page needs, and caches it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([rawOrder("a"), rawOrder("test", { testmode: true })], "next-page"))
      .mockResolvedValueOnce(page([rawOrder("b", { customerEmail: "sam@example.com" })]));
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();

    const res = await auth(request(app).get("/api/admin/members"));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=next-page");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");

    expect(res.body.configured).toBe(true);
    expect(res.body.members.totals.members).toBe(2);
    const pat = res.body.members.current.find((r) => r.email === "pat@example.com");
    // Half off: the discount is taken out of what they pay.
    expect(pat.monthlyAmount).toBe(57.5);
    // Test-mode orders and billing addresses never reach the page.
    expect(res.body.sales.totals.allTime.total).toBe(115);
    expect(JSON.stringify(res.body)).not.toContain("1 Main St");
    // Membership data stays apart from the waivers: none are read here.
    expect(res.body.conversion).toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();

    // Served from cache until a refresh is asked for.
    await auth(request(app).get("/api/admin/members"));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(page([rawOrder("a")]));
    await auth(request(app).get("/api/admin/members?refresh=true"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("serves waiver-to-member conversion on its own, without the member list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page([rawOrder("a")])));

    const res = await auth(request(createApp()).get("/api/admin/conversion"));

    expect(res.status).toBe(200);
    // Pat signed a waiver six days ago and paid five days ago.
    expect(res.body.conversion).toMatchObject({ signers: 1, joined: 1, medianDaysToJoin: 1 });
    expect(res.body.members).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("pat@example.com");
    // Only email, sign date and follow-up status are read from the waivers.
    const [waiverSql] = queryMock.mock.calls[0];
    expect(waiverSql).toMatch(/FROM waiver_submissions/);
    expect(waiverSql).not.toMatch(/signature_data_url/);
  });

  it("requires the admin passcode for conversion too", async () => {
    const res = await request(createApp()).get("/api/admin/conversion");

    expect(res.status).toBe(401);
  });

  it("502s when Squarespace refuses the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    const res = await auth(request(createApp()).get("/api/admin/members"));

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Squarespace/);
  });
});

describe("google sign-in and admin approval", () => {
  const CLIENT_ID = "client-123.apps.googleusercontent.com";
  const ticket = (payload) => ({ getPayload: () => payload });
  const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const passcode = (req) => req.set("x-admin-passcode", "changeme");
  const bearer = (req) => req.set("Authorization", "Bearer session-token");
  const googleSignIn = () =>
    request(createApp()).post("/api/admin/auth/google").send({ credential: "google-id-token" });

  // Answers the session lookup as `user` (or no one), everything else via `rest`.
  function signedInAs(user, rest = () => ({ rows: [] })) {
    queryMock.mockImplementation((sql, params) =>
      Promise.resolve(
        sql.includes("FROM admin_sessions s") ? { rows: user ? [user] : [] } : rest(sql, params)
      )
    );
  }

  beforeEach(() => {
    queryMock.mockReset();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: "<abc@local>", accepted: [], rejected: [] });
    verifyIdTokenMock.mockReset();
    process.env.ADMIN_PASSCODE = "changeme";
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
  });

  it("tells the sign-in page which Google client to use", async () => {
    const on = await request(createApp()).get("/api/admin/auth/config");
    expect(on.body).toEqual({ googleClientId: CLIENT_ID });

    delete process.env.GOOGLE_CLIENT_ID;
    const off = await request(createApp()).get("/api/admin/auth/config");
    expect(off.body).toEqual({ googleClientId: null });
  });

  it("refuses Google sign-in when no client is configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    const res = await googleSignIn();

    expect(res.status).toBe(503);
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("files a new Google account as a pending request and emails the gym", async () => {
    verifyIdTokenMock.mockResolvedValue(
      ticket({ sub: "g-1", email: "Coach@Example.com", email_verified: true, name: "Coach Kim" })
    );
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "4", email: "coach@example.com", name: "Coach Kim", status: "pending", created: true }],
    });

    const res = await googleSignIn();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "pending", email: "coach@example.com" });
    // The token must have been issued for this app's client, not any Google app.
    expect(verifyIdTokenMock).toHaveBeenCalledWith({ idToken: "google-id-token", audience: CLIENT_ID });
    expect(queryMock.mock.calls[0][1]).toEqual(["g-1", "coach@example.com", "Coach Kim"]);
    // No session until an admin approves them.
    expect(queryMock.mock.calls.some(([sql]) => sql.includes("admin_sessions"))).toBe(false);

    await waitFor("the request email", () => sendMailMock.mock.calls.length === 1);
    expect(sendMailMock.mock.calls[0][0].subject).toBe("Admin access request: Coach Kim");
  });

  it("does not email again when a pending account signs in again", async () => {
    verifyIdTokenMock.mockResolvedValue(
      ticket({ sub: "g-1", email: "coach@example.com", email_verified: true })
    );
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "4", email: "coach@example.com", name: "", status: "pending", created: false }],
    });

    const res = await googleSignIn();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(res.body.status).toBe("pending");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("gives an approved account a session and stores only its hash", async () => {
    verifyIdTokenMock.mockResolvedValue(
      ticket({ sub: "g-2", email: "owner@example.com", email_verified: true, name: "Owner" })
    );
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: "1", email: "owner@example.com", name: "Owner", status: "approved", created: false }],
      })
      .mockResolvedValue({ rows: [] });

    const res = await googleSignIn();

    expect(res.body.status).toBe("approved");
    expect(res.body.user).toEqual({ id: "1", email: "owner@example.com", name: "Owner" });
    const insert = queryMock.mock.calls.find(([sql]) => sql.includes("INSERT INTO admin_sessions"));
    expect(insert[1]).toEqual([sha256(res.body.token), "1", 30]);
  });

  it("turns away a Google account whose email is not verified", async () => {
    verifyIdTokenMock.mockResolvedValue(
      ticket({ sub: "g-3", email: "someone@example.com", email_verified: false })
    );

    const res = await googleSignIn();

    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("turns away a token Google will not verify", async () => {
    verifyIdTokenMock.mockRejectedValue(new Error("Wrong recipient, payload audience != requiredAudience"));

    const res = await googleSignIn();

    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("accepts an approved admin's session on admin routes", async () => {
    signedInAs({ id: "1", email: "owner@example.com", name: "Owner" });

    const res = await bearer(request(createApp()).get("/api/admin/auth/me"));

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("owner@example.com");
    const lookup = queryMock.mock.calls.find(([sql]) => sql.includes("FROM admin_sessions s"));
    // Looked up by hash, and only for accounts still approved and unexpired.
    expect(lookup[1]).toEqual([sha256("session-token")]);
    expect(lookup[0]).toMatch(/u\.status = 'approved'/);
    expect(lookup[0]).toMatch(/expires_at > now\(\)/);
  });

  it("rejects an unknown, expired or revoked session", async () => {
    signedInAs(null);

    const res = await bearer(request(createApp()).post("/api/admin/verify"));

    expect(res.status).toBe(401);
  });

  it("lists access requests for admins only", async () => {
    const anon = await request(createApp()).get("/api/admin/users");
    expect(anon.status).toBe(401);

    queryMock.mockResolvedValueOnce({ rows: [{ id: "4", email: "coach@example.com", status: "pending" }] });
    const res = await passcode(request(createApp()).get("/api/admin/users"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("approves a request and records which admin approved it", async () => {
    signedInAs({ id: "1", email: "owner@example.com", name: "Owner" }, (sql) =>
      sql.includes("SET status = 'approved'")
        ? { rows: [{ id: "4", email: "coach@example.com", status: "approved" }] }
        : { rows: [] }
    );

    const res = await bearer(request(createApp()).post("/api/admin/users/4/approve"));

    expect(res.status).toBe(200);
    const update = queryMock.mock.calls.find(([sql]) => sql.includes("SET status = 'approved'"));
    expect(update[1]).toEqual([4, "owner@example.com"]);
  });

  it("records an approval made with the passcode as such", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "4", status: "approved" }] });

    await passcode(request(createApp()).post("/api/admin/users/4/approve"));

    expect(queryMock.mock.calls[0][1]).toEqual([4, "passcode"]);
  });

  it("denies or removes access by deleting the account", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "4", email: "coach@example.com" }] });

    const res = await passcode(request(createApp()).delete("/api/admin/users/4"));

    expect(res.status).toBe(200);
    expect(queryMock.mock.calls[0][0]).toMatch(/DELETE FROM admin_users/);
  });

  it("will not let an admin remove themselves", async () => {
    signedInAs({ id: "4", email: "coach@example.com", name: "" });

    const res = await bearer(request(createApp()).delete("/api/admin/users/4"));

    expect(res.status).toBe(400);
    expect(queryMock.mock.calls.some(([sql]) => sql.includes("DELETE FROM admin_users"))).toBe(false);
  });

  it("signing out deletes the session", async () => {
    signedInAs({ id: "1", email: "owner@example.com", name: "Owner" });

    const res = await bearer(request(createApp()).post("/api/admin/auth/logout"));

    expect(res.status).toBe(200);
    const del = queryMock.mock.calls.find(([sql]) =>
      sql.includes("DELETE FROM admin_sessions WHERE token_hash")
    );
    expect(del[1]).toEqual([sha256("session-token")]);
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
