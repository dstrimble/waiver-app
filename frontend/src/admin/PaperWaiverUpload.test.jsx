import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PaperWaiverUpload from "./PaperWaiverUpload.jsx";
import { cropToPage } from "./paperScan.js";

// jsdom has no canvas, so the photo handling is stood in for; its maths has its own tests.
vi.mock("./paperScan.js", () => ({
  FULL_FRAME: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  loadPhoto: vi.fn(() => Promise.resolve({ dataUrl: "data:image/jpeg;base64,PHOTO", width: 2000, height: 1500 })),
  cropToPage: vi.fn(() => "data:image/jpeg;base64,PAGE"),
}));

function stubSave(res = { ok: true, body: { ok: true, ids: ["31", "32"], emailed: true } }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: res.ok, json: () => Promise.resolve(res.body) }))
  );
}

async function pickPhoto() {
  fireEvent.change(screen.getByLabelText(/photo of the signed waiver/i), {
    target: { files: [new File(["x"], "waiver.jpg", { type: "image/jpeg" })] },
  });
  await screen.findByLabelText("Name (signer)");
}

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("PaperWaiverUpload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cropToPage.mockClear();
  });

  it("saves the details typed in from the paper, with the page cropped out of the photo", async () => {
    stubSave();
    const onSaved = vi.fn();
    render(<PaperWaiverUpload auth={{ passcode: "x" }} onSaved={onSaved} onCancel={() => {}} />);
    await pickPhoto();

    type("Name (signer)", "Jane Smith");
    type("Email", "jane@example.com");
    type("City", "Conway");
    type("Date signed", "2026-09-10");
    fireEvent.click(screen.getByRole("button", { name: "Signer and kids" }));
    type("Signer's date of birth", "1990-04-02");
    fireEvent.click(screen.getAllByLabelText("BJJ")[0]);
    type("Child's name", "Max Smith");
    type("Date of birth", "2016-05-01");
    // Nudge the top-left corner in from the edge of the photo.
    const topLeft = screen.getByRole("button", { name: "Top-left corner of the page" });
    fireEvent.keyDown(topLeft, { key: "ArrowRight" });
    fireEvent.keyDown(topLeft, { key: "ArrowDown", shiftKey: true });

    // Nothing is saved until someone has checked it against the paper.
    const save = screen.getByRole("button", { name: "Save paper waiver" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/checked these details/i));
    fireEvent.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/admin/paper-waivers");
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
    const [, corners] = cropToPage.mock.calls.at(-1);
    expect(corners[0].x).toBeCloseTo(0.004);
    expect(corners[0].y).toBeCloseTo(0.02);
    expect(corners.slice(1)).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ ids: ["31", "32"], name: "Jane Smith" }));
  });

  it("shows why a waiver could not be saved, and keeps what was typed", async () => {
    stubSave({ ok: false, body: { error: "Someone under 18 needs a parent or guardian to sign for them." } });
    const onSaved = vi.fn();
    render(<PaperWaiverUpload auth={{ passcode: "x" }} onSaved={onSaved} onCancel={() => {}} />);
    await pickPhoto();

    type("Name (signer)", "Teen Signer");
    type("Signer's date of birth", "2012-01-01");
    fireEvent.click(screen.getByLabelText(/checked these details/i));
    fireEvent.click(screen.getByRole("button", { name: "Save paper waiver" }));

    expect(await screen.findByText(/needs a parent or guardian/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name (signer)")).toHaveValue("Teen Signer");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
