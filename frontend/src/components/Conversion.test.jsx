import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ConversionSection from "./Conversion.jsx";

const DATA = {
  configured: true,
  fetchedAt: "2026-09-11T12:00:00Z",
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
};

describe("ConversionSection", () => {
  it("shows how many waiver signers became members", () => {
    render(<ConversionSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

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

  it("lists the most recent month first", () => {
    render(<ConversionSection data={DATA} loading={false} error="" onRefresh={() => {}} />);

    const firstRow = screen.getAllByRole("row")[1];
    expect(within(firstRow).getAllByRole("cell")[0].textContent).toBe("Sep 26");
  });

  it("says when Squarespace is not connected", () => {
    render(<ConversionSection data={{ configured: false }} loading={false} error="" onRefresh={() => {}} />);

    expect(screen.getByText(/squarespace is not connected/i)).toBeInTheDocument();
  });
});
