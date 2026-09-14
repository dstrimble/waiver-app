import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PaperWaiverUpload from "./PaperWaiverUpload.jsx";

// jsdom has no canvas, so the photo handling is stood in for; its maths has its own tests.
vi.mock("./paperScan.js", () => ({
  FULL_FRAME: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  isUsablePage: () => true,
  loadPhoto: vi.fn(() => Promise.resolve({ dataUrl: "data:image/jpeg;base64,PHOTO", width: 2000, height: 1500 })),
  cropToPage: vi.fn(() => "data:image/jpeg;base64,PAGE"),
}));

const READING = {
  signer: {
    name: "Jane Smith",
    email: "jane@example.com",
    address: "",
    city: "Conway",
    state: "AR",
    zip: "",
    cellPhone: "501-555-0100",
    homePhone: "",
    otherGymMember: "",
    membershipExpires: "",
    heardAbout: "Google",
    lookingFor: "",
  },
  participants: [
    { name: "Jane Smith", dateOfBirth: "1990-04-02", interests: ["BJJ"], isSigner: true },
    { name: "Max Smith", dateOfBirth: "2016-05-01", interests: ["Kids Classes"], isSigner: false },
  ],
  signedOn: "2026-09-10",
  signed: true,
  notes: "The zip code is smudged.",
  corners: [
    { x: 0.05, y: 0.03 },
    { x: 0.95, y: 0.05 },
    { x: 0.97, y: 0.97 },
    { x: 0.03, y: 0.93 },
  ],
};

function stubFetch(read = { ok: true, body: READING }) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url) => {
      const res =
        url === "/api/admin/paper-waivers/read" ? read : { ok: true, body: { ok: true, ids: ["31", "32"], emailed: true } };
      return Promise.resolve({ ok: res.ok, json: () => Promise.resolve(res.body) });
    })
  );
}

function pickPhoto() {
  fireEvent.change(screen.getByLabelText(/photo of the signed waiver/i), {
    target: { files: [new File(["x"], "waiver.jpg", { type: "image/jpeg" })] },
  });
}

describe("PaperWaiverUpload", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fills in the waiver from the photo, and saves it with the page cropped out", async () => {
    stubFetch();
    const onSaved = vi.fn();
    render(<PaperWaiverUpload auth={{ passcode: "x" }} onSaved={onSaved} onCancel={() => {}} />);

    pickPhoto();

    expect(await screen.findByDisplayValue("Max Smith")).toBeInTheDocument();
    expect(screen.getByLabelText("Name (signer)")).toHaveValue("Jane Smith");
    expect(screen.getByLabelText("Date signed")).toHaveValue("2026-09-10");
    expect(screen.getByText(/zip code is smudged/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Signer and kids" })).toHaveAttribute("aria-pressed", "true");

    // Nothing is saved until someone has checked it against the paper.
    const save = screen.getByRole("button", { name: "Save paper waiver" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/checked these details/i));
    fireEvent.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, init] = fetch.mock.calls.find(([url]) => url === "/api/admin/paper-waivers");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      signedOn: "2026-09-10",
      confirmedSigned: true,
      scanDataUrl: "data:image/jpeg;base64,PAGE",
    });
    expect(body.signer).toMatchObject({ name: "Jane Smith", email: "jane@example.com", city: "Conway" });
    expect(body.participants).toEqual([
      { isSigner: true, dateOfBirth: "1990-04-02", interests: ["BJJ"] },
      { name: "Max Smith", dateOfBirth: "2016-05-01", interests: ["Kids Classes"] },
    ]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ ids: ["31", "32"], name: "Jane Smith" }));
  });

  it("still takes the waiver when the photo can't be read, to be typed in", async () => {
    stubFetch({ ok: false, body: { error: "Reading photos is not set up on this server." } });
    render(<PaperWaiverUpload auth={{ passcode: "x" }} onSaved={() => {}} onCancel={() => {}} />);

    pickPhoto();

    expect(await screen.findByText(/Reading photos is not set up/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name (signer)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save paper waiver" })).toBeInTheDocument();
  });
});
