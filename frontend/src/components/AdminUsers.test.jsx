import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminUsers from "./AdminUsers.jsx";

const USERS = [
  { id: "4", email: "coach@example.com", name: "Coach Kim", status: "pending", created_at: "2026-09-10T12:00:00Z" },
  { id: "1", email: "owner@example.com", name: "Owner", status: "approved", approved_by: "passcode" },
  { id: "2", email: "front@example.com", name: "Front Desk", status: "approved", approved_by: "owner@example.com" },
];

function renderPanel(props = {}) {
  const handlers = { onApprove: vi.fn(), onRemove: vi.fn() };
  render(<AdminUsers users={USERS} currentUserId="1" busyId={null} {...handlers} {...props} />);
  return handlers;
}

describe("AdminUsers", () => {
  it("offers approve and deny for a pending request", () => {
    const { onApprove, onRemove } = renderPanel();

    const request = screen.getByText("Coach Kim").closest("li");
    within(request).getByRole("button", { name: "Approve" }).click();
    within(request).getByRole("button", { name: "Deny" }).click();

    expect(onApprove).toHaveBeenCalledWith(USERS[0]);
    expect(onRemove).toHaveBeenCalledWith(USERS[0]);
  });

  it("lets an admin remove others but not themselves", () => {
    const { onRemove } = renderPanel();

    const self = screen.getByText(/Owner \(you\)/).closest("li");
    expect(within(self).getByRole("button", { name: "Remove" })).toBeDisabled();

    const other = screen.getByText("Front Desk").closest("li");
    within(other).getByRole("button", { name: "Remove" }).click();
    expect(onRemove).toHaveBeenCalledWith(USERS[2]);
  });

  it("says so when no one is waiting", () => {
    renderPanel({ users: USERS.filter((u) => u.status === "approved") });

    expect(screen.getByText(/no one is waiting/i)).toBeInTheDocument();
  });
});
