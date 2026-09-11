import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WaiverAdmin, { ageFrom } from "./WaiverAdmin.jsx";

// Jan 1 birthdays make the age exact on any day of the current year.
const bornYearsAgo = (years) => `${new Date().getFullYear() - years}-01-01`;

const WAIVERS = [
  {
    id: "1",
    name: "Ada Adult",
    email: "ada@example.com",
    date_of_birth: bornYearsAgo(34),
    submitted_at: "2026-08-01T12:00:00Z",
    mattracker_error: "MatTracker returned HTTP 503",
  },
  { id: "2", name: "Kit Kid", email: "parent@example.com", date_of_birth: bornYearsAgo(9), submitted_at: "2026-08-02T12:00:00Z" },
  { id: "3", name: "Teen Fourteen", email: "teen@example.com", date_of_birth: bornYearsAgo(14), submitted_at: "2026-08-03T12:00:00Z" },
  { id: "4", name: "Old Member", email: "member@example.com", date_of_birth: null, submitted_at: "2026-08-04T12:00:00Z" },
];

const CONVERSION = {
  configured: true,
  fetchedAt: "2026-09-11T12:00:00Z",
  conversion: {
    signers: 3,
    joined: 1,
    rate: 1 / 3,
    alreadyPaying: 1,
    medianDaysToJoin: 6,
    followUp: { sent: { signers: 0, joined: 0, rate: 0 }, notSent: { signers: 3, joined: 1, rate: 1 / 3 } },
    byMonth: [{ month: "2026-08", signers: 3, joined: 1, rate: 1 / 3 }],
    byWaiver: {
      1: { status: "joined", joinedAt: "2026-08-07T12:00:00Z", daysToJoin: 6 },
      4: { status: "alreadyPaying" },
    },
  },
};

function stubApi(conversion = CONVERSION) {
  const routes = {
    "/api/admin/waivers": WAIVERS,
    "/api/admin/stats": { error: "not in this test" },
    "/api/admin/conversion": conversion,
    "/api/admin/waivers/1/mattracker": { ok: true },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url) => {
      const body = routes[String(url).split("?")[0]];
      return Promise.resolve({ ok: !body.error, json: () => Promise.resolve(body) });
    })
  );
}

// Names also appear in the detail panel's heading, so look inside the list.
const list = () => screen.getByRole("list");
const rowFor = (name) => within(list()).getByText(name).closest("button");
const waitForList = () => screen.findByRole("button", { name: /ada adult/i });

describe("WaiverAdmin list", () => {
  beforeEach(() => stubApi());
  afterEach(() => vi.unstubAllGlobals());

  it("counts anyone older than 13 as an adult", () => {
    const today = new Date(2026, 8, 11);
    expect(ageFrom("2012-09-12", today)).toBe(13);
    expect(ageFrom("2012-09-11", today)).toBe(14);
    expect(ageFrom(null, today)).toBeNull();
  });

  it("tags each waiver as a kid or an adult", async () => {
    render(<WaiverAdmin auth={{ passcode: "x" }} />);
    await waitForList();

    expect(within(rowFor("Ada Adult")).getByText("Adult · 34")).toBeInTheDocument();
    expect(within(rowFor("Kit Kid")).getByText("Kid · 9")).toBeInTheDocument();
    expect(within(rowFor("Teen Fourteen")).getByText("Adult · 14")).toBeInTheDocument();
  });

  it("highlights waivers whose signer became a member", async () => {
    render(<WaiverAdmin auth={{ passcode: "x" }} />);
    await screen.findByText("Became a member");

    expect(rowFor("Ada Adult")).toHaveClass("is-converted");
    expect(rowFor("Kit Kid")).not.toHaveClass("is-converted");
    expect(within(rowFor("Old Member")).getByText("Already a member")).toBeInTheDocument();
    expect(rowFor("Old Member")).not.toHaveClass("is-converted");
    // The first waiver is selected, and its detail says when they joined.
    expect(screen.getByText(/6 days after signing/)).toBeInTheDocument();
  });

  it("filters to kids, adults, or people who became members", async () => {
    render(<WaiverAdmin auth={{ passcode: "x" }} />);
    await screen.findByText("Became a member");
    const names = () =>
      within(list())
        .getAllByRole("button")
        .map((b) => b.querySelector("strong").textContent);

    fireEvent.click(screen.getByRole("button", { name: "Kids" }));
    expect(names()).toEqual(["Kit Kid"]);

    fireEvent.click(screen.getByRole("button", { name: "Adults" }));
    expect(names()).toEqual(["Ada Adult", "Teen Fourteen"]);

    fireEvent.click(screen.getByRole("button", { name: "Became members" }));
    expect(names()).toEqual(["Ada Adult"]);
  });

  it("shows MatTracker status and sends a waiver again on request", async () => {
    render(<WaiverAdmin auth={{ passcode: "x" }} />);
    await waitForList();

    expect(screen.getByText(/Not set up - MatTracker returned HTTP 503/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send to MatTracker" }));

    expect(await screen.findByText("Ada Adult is set up in MatTracker.")).toBeInTheDocument();
    const call = fetch.mock.calls.find(([url]) => url === "/api/admin/waivers/1/mattracker");
    expect(call[1]).toMatchObject({ method: "POST", headers: { "x-admin-passcode": "x" } });
  });

  it("leaves out membership marks when Squarespace is not connected", async () => {
    stubApi({ configured: false });
    render(<WaiverAdmin auth={{ passcode: "x" }} />);
    await waitForList();

    expect(screen.queryByRole("button", { name: "Became members" })).not.toBeInTheDocument();
    expect(screen.queryByText(/blue: became/i)).not.toBeInTheDocument();
    expect(within(rowFor("Kit Kid")).getByText("Kid · 9")).toBeInTheDocument();
  });
});
