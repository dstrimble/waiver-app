import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MembersSection from "./Members.jsx";

const DATA = {
  configured: true,
  fetchedAt: "2026-09-11T12:00:00Z",
  members: {
    totals: { members: 1, children: 1, allTimeMembers: 3, coaches: 2, monthlyRevenue: 3591.67 },
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

describe("MembersSection", () => {
  it("lists current members with Add Child in its own column", () => {
    render(<MembersSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

    const row = screen.getByRole("row", { name: /pat lee/i });
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(0, 4)).toEqual(["Pat Lee", "pat@example.com", "Physical Membership", "Yes"]);
    expect(cells[5]).toBe("$125/mo");
  });

  it("shows sales totals split by category", () => {
    render(<MembersSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

    expect(screen.getByRole("heading", { name: /sales by month/i })).toBeInTheDocument();
    expect(screen.getByText("$1,270")).toBeInTheDocument();
    expect(screen.getByText("Retail, 12 months")).toBeInTheDocument();
  });

  it("shows monthly membership revenue in place of an all-time count", () => {
    render(<MembersSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

    const tile = screen.getByText("Monthly membership revenue").closest(".viz-tile");
    expect(within(tile).getByText("$3,592")).toBeInTheDocument();
    expect(screen.queryByText(/members all time/i)).not.toBeInTheDocument();
  });

  it("captions every cell, so the phone card layout can label them", () => {
    render(<MembersSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

    const row = screen.getByRole("row", { name: /pat lee/i });
    const labels = within(row)
      .getAllByRole("cell")
      .map((cell) => cell.getAttribute("data-label"));
    expect(labels).toEqual(["Name", "Email", "Plan", "Add Child", "Member since", "Paying", "Last charged"]);
  });

  it("says how many coaches were left out of the count", () => {
    render(<MembersSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

    expect(screen.getByText("2 coaches on the coach discount not counted")).toBeInTheDocument();
  });

  it("keeps waiver conversion off the membership page", () => {
    render(<MembersSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

    expect(screen.queryByText(/waivers to members/i)).not.toBeInTheDocument();
  });

  it("refreshes on request", () => {
    const onRefresh = vi.fn();
    render(<MembersSection data={DATA} loading={false} error="" onRefresh={onRefresh} />);

    screen.getByRole("button", { name: /refresh/i }).click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("says when Squarespace is not connected", () => {
    render(<MembersSection data={{ configured: false }} loading={false} error="" onRefresh={() => {}} />);

    expect(screen.getByText(/squarespace is not connected/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh/i })).not.toBeInTheDocument();
  });
});
