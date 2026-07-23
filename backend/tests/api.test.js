import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("../src/db.js", () => ({
  pool: {
    query: (...args) => queryMock(...args),
  },
}));

import { createApp } from "../src/app.js";

describe("waiver api", () => {
  beforeEach(() => {
    queryMock.mockReset();
    process.env.ADMIN_PASSCODE = "changeme";
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
    queryMock.mockResolvedValueOnce({ rows: [{ id: 1, submitted_at: "2026-07-23T00:00:00.000Z" }] });

    const res = await request(createApp()).post("/api/waivers").send({
      interests: ["BJJ", "MMA"],
      name: "Jane Doe",
      email: "jane@example.com",
      dateOfBirth: "2000-01-01",
      accepted: true,
      signatureName: "Jane Doe",
      signatureDataUrl: "data:image/png;base64,AAAA",
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("POST /api/admin/verify unlocks with correct passcode", async () => {
    const res = await request(createApp())
      .post("/api/admin/verify")
      .set("x-admin-passcode", "changeme");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
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
