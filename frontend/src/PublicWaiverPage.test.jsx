import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicWaiverPage from "./PublicWaiverPage.jsx";

// The real pad draws on a canvas, which jsdom does not have.
vi.mock("./components/SignaturePad.jsx", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    default: forwardRef(function FakeSignaturePad(_props, ref) {
      useImperativeHandle(ref, () => ({
        isEmpty: () => false,
        toDataURL: () => "data:image/png;base64,AAAA",
        clear: () => {},
      }));
      return <div data-testid="signature-pad" />;
    }),
  };
});

const WAIVER_TEXT = {
  version: "v2",
  paragraphs: ["Assumption of risk."],
  acceptanceStatement: "I have read and agree to the waiver and release above.",
};

// Jan 1 birthdays make ages exact on any day of the current year.
const bornYearsAgo = (years) => `01/01/${new Date().getFullYear() - years}`;

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn((url, init) => {
    const body = init?.method === "POST" ? { id: 1, ids: [1, 2, 3] } : WAIVER_TEXT;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const type = (field, value) => fireEvent.change(field, { target: { value } });
const card = (name) => screen.getByRole("region", { name });
const choose = (label) => fireEvent.click(screen.getByRole("radio", { name: label }));

async function renderForm() {
  render(<PublicWaiverPage />);
  await screen.findByText("Assumption of risk.");
}

function fillSignerAndSign(name = "Jane Smith") {
  type(screen.getByLabelText(/your name/i), name);
  type(screen.getByLabelText(/^email/i), "jane@example.com");
  fireEvent.click(screen.getByRole("checkbox"));
  type(screen.getByLabelText(/signature name/i), name);
}

function fillKid(title, name, dob) {
  const region = card(title);
  type(within(region).getByLabelText(/child's name/i), name);
  // The calendar button also mentions "date of birth"; the typed field is the one to fill.
  type(within(region).getByPlaceholderText("MM/DD/YYYY"), dob);
}

const submit = () => fireEvent.submit(screen.getByRole("button", { name: /submit waiver/i }).closest("form"));
const postedBody = () => JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")[1].body);

describe("public waiver form", () => {
  it("starts as a waiver for just the person signing", async () => {
    await renderForm();

    expect(screen.getByRole("radio", { name: "Just me" })).toHaveAttribute("aria-checked", "true");
    expect(card("About You")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Child 1" })).not.toBeInTheDocument();
  });

  it("adds and removes children", async () => {
    await renderForm();
    choose("My kids");

    expect(card("Child 1")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "You" })).not.toBeInTheDocument();
    // The only child cannot be removed.
    expect(screen.queryByRole("button", { name: "Remove Child 1" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add another child/i }));
    fillKid("Child 2", "Ada Smith", bornYearsAgo(7));
    fireEvent.click(screen.getByRole("button", { name: "Remove Child 1" }));

    // Ada moves up to be Child 1, keeping what was typed.
    expect(within(card("Child 1")).getByLabelText(/child's name/i)).toHaveValue("Ada Smith");
    expect(screen.queryByRole("region", { name: "Child 2" })).not.toBeInTheDocument();
  });

  it("submits a parent and their kids as one waiver", async () => {
    await renderForm();
    choose("Me and my kids");
    fillSignerAndSign();
    type(within(card("You")).getByPlaceholderText("MM/DD/YYYY"), bornYearsAgo(36));
    fireEvent.click(within(card("You")).getByRole("button", { name: "BJJ" }));
    fillKid("Child 1", "Max Smith", bornYearsAgo(9));
    fireEvent.click(screen.getByRole("button", { name: /add another child/i }));
    fillKid("Child 2", "Ada Smith", bornYearsAgo(7));

    submit();

    expect(await screen.findByText(/the waiver for you, Max Smith and Ada Smith has been submitted/i)).toBeInTheDocument();
    const body = postedBody();
    expect(body.signer).toMatchObject({ name: "Jane Smith", email: "jane@example.com" });
    const year = new Date().getFullYear();
    expect(body.participants).toEqual([
      { isSigner: true, name: "Jane Smith", dateOfBirth: `${year - 36}-01-01`, interests: ["BJJ"] },
      { name: "Max Smith", dateOfBirth: `${year - 9}-01-01`, interests: ["Kids Classes"] },
      { name: "Ada Smith", dateOfBirth: `${year - 7}-01-01`, interests: ["Kids Classes"] },
    ]);
    expect(body.signatureDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("sends only the children when the parent is not training", async () => {
    await renderForm();
    choose("My kids");
    fillSignerAndSign();
    fillKid("Child 1", "Max Smith", bornYearsAgo(9));

    submit();

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    expect(postedBody().participants.map((p) => p.name)).toEqual(["Max Smith"]);
    expect(postedBody().participants[0].isSigner).toBeUndefined();
  });

  it("will not let someone under 18 sign for themselves", async () => {
    await renderForm();
    fillSignerAndSign("Teen Kid");
    type(within(card("About You")).getByPlaceholderText("MM/DD/YYYY"), bornYearsAgo(15));

    submit();

    expect(await screen.findByText(/under 18\? a parent or guardian needs to sign/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("will not list an adult as a child", async () => {
    await renderForm();
    choose("My kids");
    fillSignerAndSign();
    fillKid("Child 1", "Grown Kid", bornYearsAgo(19));

    submit();

    expect(await screen.findByText(/grown kid is 18 or over/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
});
