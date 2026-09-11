import { useState } from "react";
import { adminChangePasscode } from "../api.js";
import AdminUsers from "../components/AdminUsers.jsx";
import AdminLink from "./AdminLink.jsx";

const SECTIONS = [
  {
    to: "/admin/waiver",
    title: "Waivers",
    text: "Signed waivers, trends, follow-up emails, and how many signers became members.",
  },
  {
    to: "/admin/members",
    title: "Members & sales",
    text: "Current members, membership over time, and monthly sales from Squarespace.",
  },
];

const EMPTY_CHANGE = { currentPasscode: "", newPasscode: "", confirmPasscode: "" };

/** Admin home: links to each section, account approvals, and the passcode. */
export default function AdminHome({
  auth,
  users,
  usersBusy,
  usersError,
  onApprove,
  onRemove,
  onPasscodeChanged,
  onNavigate,
}) {
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changeForm, setChangeForm] = useState(EMPTY_CHANGE);
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeError, setChangeError] = useState("");
  const [changeSuccess, setChangeSuccess] = useState("");

  function updateChangeField(key, value) {
    setChangeForm((current) => ({ ...current, [key]: value }));
  }

  async function submitPasscodeChange(e) {
    e.preventDefault();
    setChangeBusy(true);
    setChangeError("");
    setChangeSuccess("");
    try {
      await adminChangePasscode(auth, changeForm);
      onPasscodeChanged(changeForm.newPasscode);
      setChangeForm(EMPTY_CHANGE);
      setChangeSuccess("Admin password updated.");
    } catch (err) {
      setChangeError(err.message || "Failed to update password.");
    } finally {
      setChangeBusy(false);
    }
  }

  return (
    <>
      <nav className="admin-links" aria-label="Admin pages">
        {SECTIONS.map((section) => (
          <AdminLink key={section.to} to={section.to} onNavigate={onNavigate} className="admin-link-card">
            <strong>{section.title}</strong>
            <span>{section.text}</span>
          </AdminLink>
        ))}
      </nav>

      <AdminUsers
        users={users}
        currentUserId={auth.user?.id}
        busyId={usersBusy}
        onApprove={onApprove}
        onRemove={onRemove}
      />
      {usersError ? <p className="error">{usersError}</p> : null}

      <div className="admin-home-passcode">
        <button
          type="button"
          className="ghost"
          onClick={() => setShowChangePassword((value) => !value)}
          aria-expanded={showChangePassword}
          aria-controls="change-password-panel"
        >
          {showChangePassword ? "Hide password form" : "Change password"}
        </button>

        {showChangePassword ? (
          <form id="change-password-panel" className="admin-passcode-form" onSubmit={submitPasscodeChange}>
            <label>
              Current Passcode
              <input
                type="password"
                value={changeForm.currentPasscode}
                onChange={(e) => updateChangeField("currentPasscode", e.target.value)}
                required
              />
            </label>
            <label>
              New Passcode
              <input
                type="password"
                minLength={8}
                value={changeForm.newPasscode}
                onChange={(e) => updateChangeField("newPasscode", e.target.value)}
                required
              />
            </label>
            <label>
              Confirm New Passcode
              <input
                type="password"
                minLength={8}
                value={changeForm.confirmPasscode}
                onChange={(e) => updateChangeField("confirmPasscode", e.target.value)}
                required
              />
            </label>
            <button type="submit" className="ghost" disabled={changeBusy}>
              {changeBusy ? "Saving..." : "Save Password"}
            </button>
          </form>
        ) : null}
        {changeError ? <p className="error">{changeError}</p> : null}
        {changeSuccess ? <p className="success">{changeSuccess}</p> : null}
      </div>
    </>
  );
}
