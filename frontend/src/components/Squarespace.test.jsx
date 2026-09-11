import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SquarespaceSection from "./Squarespace.jsx";

const DATA = {
  configured: true,
  fetchedAt: "2026-09-11T12:00:00Z",
  members: {
    totals: { members: 1, children: 1, allTimeMembers: 3 },
    timeline: [
      { month: "2026-08", partial: false, members: 1, children: 0, joined: 1, left: 0 },
      { month: "2026-09", partial: true, members: 1, children: 1, joined: 0, left: 0 },
    ],
    current: [
      {
        email: "pat@example.com",
        name: "Pat Lee",
        plans: ["Physical Membership"],
        addChild: true,
        memberSince: "2026-08-01T12:00:00Z",
        lastChargedAt: "2026-09-01T12:00:00Z",
        monthlyAmount: 125,
        annualAmount: 0,
      },
    ],
  },
  conversion: {
    signers: 10,
    joined: 3,
    rate: 0.3,
    alreadyPaying: 2,
    medianDaysToJoin: 9,
    followUp: {
      sent: { signers: 4, joined: 2, rate: 0.5 },
      notSent: { signers: 6, joined: 1, rate: 1 / 6 },
    },
    byMonth: [
      { month: "2026-08", signers: 6, joined: 2, rate: 1 / 3 },
      { month: "2026-09", signers: 4, joined: 1, rate: 0.25 },
    ],
  },
  sales: {
    months: [
      { month: "2026-08", partial: false, memberships: 100, retail: 5, events: 40, total: 145 },
      { month: "2026-09", partial: true, memberships: 125, retail: 0, events: 0, total: 125 },
    ],
    totals: {
      thisMonth: 125,
      last12: { memberships: 1225, retail: 5, events: 40, total: 1270 },
      allTime: { memberships: 1225, retail: 5, events: 40, total: 1270 },
    },
  },
};

describe("SquarespaceSection", () => {
  it("lists current members with Add Child in its own column", () => {
    render(<SquarespaceSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

    const row = screen.getByRole("row", { name: /pat lee/i });
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(0, 4)).toEqual(["Pat Lee", "pat@example.com", "Physical Membership", "Yes"]);
    expect(cells[5]).toBe("$125/mo");
  });

  it("shows sales totals split by category", () => {
    render(<SquarespaceSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

    expect(screen.getByRole("heading", { name: /sales by month/i })).toBeInTheDocument();
    expect(screen.getByText("$1,270")).toBeInTheDocument();
    expect(screen.getByText("Retail, 12 months")).toBeInTheDocument();
  });

  it("shows how many waiver signers became members", () => {
    render(<SquarespaceSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("9 days")).toBeInTheDocument();
    const followed = screen.getByRole("row", { name: /sent the follow-up/i });
    expect(within(followed).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Sent the follow-up",
      "4",
      "2",
      "50%",
    ]);
  });

  it("refreshes on request", () => {
    const onRefresh = vi.fn();
    render(<SquarespaceSection data={DATA} loading={false} error="" onRefresh={onRefresh} />);

    screen.getByRole("button", { name: /refresh/i }).click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("says when Squarespace is not connected", () => {
    render(
      <SquarespaceSection data={{ configured: false }} loading={false} error="" onRefresh={() => {}} />
    );

    expect(screen.getByText(/squarespace is not connected/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh/i })).not.toBeInTheDocument();
  });
});
