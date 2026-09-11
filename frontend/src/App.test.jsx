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
  window.history.pushState({}, "", "/");
});

describe("admin route", () => {
  it("serves the admin page at /admin", () => {
    window.history.pushState({}, "", "/admin");
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: /waiver admin/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unlock admin/i })).toBeInTheDocument();
  });

  it("no longer serves it at /waiver/admin (nginx redirects that to /admin)", () => {
    window.history.pushState({}, "", "/waiver/admin");
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: /page not found/i })).toBeInTheDocument();
  });
});

describe("admin sign-in", () => {
  // Answer each API path with its own body; { error } bodies come back as failures.
  function routeFetch(routes) {
    const fetchMock = vi.fn((url) => {
      const body = routes[String(url).split("?")[0]] ?? WAIVER_TEXT;
      const ok = !body.error;
      return Promise.resolve({ ok, json: () => Promise.resolve(body) });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  // Node 25 ships its own localStorage that shadows jsdom's and has no working
  // methods without a backing file, so give each test a fresh in-memory one.
  beforeEach(() => {
    const store = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
        clear: () => store.clear(),
      },
    });
  });

  it("offers Google sign-in when a client is configured", async () => {
    routeFetch({ "/api/admin/auth/config": { googleClientId: "client-123" } });
    window.history.pushState({}, "", "/admin");
    render(<App />);

    expect(await screen.findByText(/need an existing admin to approve them/i)).toBeInTheDocument();
    expect(screen.getByText(/or use the passcode/i)).toBeInTheDocument();
  });

  it("offers only the passcode when Google is not set up", async () => {
    const fetchMock = routeFetch({ "/api/admin/auth/config": { googleClientId: null } });
    window.history.pushState({}, "", "/admin");
    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/auth/config"));
    expect(screen.queryByText(/or use the passcode/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unlock admin/i })).toBeInTheDocument();
  });

  it("picks a stored Google session back up after a reload", async () => {
    window.localStorage.setItem("waiver-admin-session", "stored-token");
    const fetchMock = routeFetch({
      "/api/admin/auth/config": { googleClientId: "client-123" },
      "/api/admin/auth/me": { user: { id: "1", email: "owner@example.com", name: "Owner" } },
      "/api/admin/waivers": [],
      "/api/admin/users": [],
      "/api/admin/stats": { error: "not in this test" },
      "/api/admin/squarespace": { configured: false },
    });
    window.history.pushState({}, "", "/admin");
    render(<App />);

    expect(await screen.findByText("Signed in as owner@example.com")).toBeInTheDocument();
    const me = fetchMock.mock.calls.find(([url]) => url === "/api/admin/auth/me");
    expect(me[1].headers).toEqual({ Authorization: "Bearer stored-token" });
  });

  it("forgets a stored session the backend no longer accepts", async () => {
    window.localStorage.setItem("waiver-admin-session", "revoked-token");
    routeFetch({ "/api/admin/auth/me": { error: "Your admin session has ended. Sign in again." } });
    window.history.pushState({}, "", "/admin");
    render(<App />);

    await waitFor(() => expect(window.localStorage.getItem("waiver-admin-session")).toBeNull());
    expect(screen.getByRole("button", { name: /unlock admin/i })).toBeInTheDocument();
  });
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
