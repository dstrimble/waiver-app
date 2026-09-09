import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

const WAIVER_TEXT = {
  version: "v1",
  paragraphs: ["Assumption of risk: this is the waiver copy served by the API."],
  acceptanceStatement: "I have read and agree to the waiver and release above.",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(WAIVER_TEXT),
      })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders waiver heading", async () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: /waiver & release/i })
    ).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/waivers/text"));
  });

  it("renders the waiver copy fetched from the API", async () => {
    render(<App />);

    expect(screen.getByText(/loading waiver text/i)).toBeInTheDocument();
    expect(await screen.findByText(WAIVER_TEXT.paragraphs[0])).toBeInTheDocument();
    expect(screen.queryByText(/loading waiver text/i)).not.toBeInTheDocument();
  });

  it("blocks submission until the waiver copy has loaded", async () => {
    render(<App />);

    const submit = screen.getByRole("button", { name: /submit waiver/i });
    expect(submit).toBeDisabled();
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("shows an error when the waiver copy cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    render(<App />);

    expect(await screen.findByText(/could not load the waiver text/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit waiver/i })).toBeDisabled();
  });
});
