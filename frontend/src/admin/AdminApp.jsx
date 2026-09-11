import { useEffect, useState } from "react";
import {
  adminApproveUser,
  adminGetMe,
  adminGoogleSignIn,
  adminListUsers,
  adminLogout,
  adminRemoveUser,
  getAdminAuthConfig,
  verifyAdmin,
} from "../api.js";
import GoogleSignIn from "../components/GoogleSignIn.jsx";
import AdminHome from "./AdminHome.jsx";
import AdminLink from "./AdminLink.jsx";
import MembersAdmin from "./MembersAdmin.jsx";
import WaiverAdmin from "./WaiverAdmin.jsx";

const PAGES = {
  home: {
    title: "Admin",
    blurb: "Approve admin accounts and get to the waiver and membership pages.",
  },
  waivers: {
    title: "Waivers",
    blurb: "Signed waivers, trends, follow-ups, and how many signers became members.",
  },
  members: {
    title: "Members & Sales",
    blurb: "Current members, membership over time, and sales, from Squarespace.",
  },
  missing: {
    title: "Page Not Found",
    blurb: "There is no admin page at this address.",
  },
};

/** Which admin page a path is, or null when it is not an admin path at all. */
export function adminRoute(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  if (path === "/admin") return "home";
  // The waiver page answers at both spellings; /waiver/admin is its old address.
  if (path === "/admin/waiver" || path === "/waiver/admin") return "waivers";
  if (path === "/admin/members") return "members";
  if (path.startsWith("/admin/")) return "missing";
  return null;
}

// A Google admin stays signed in across reloads. Storage can be unavailable
// (private windows, blocked site data); then the session lasts for this visit.
const SESSION_KEY = "waiver-admin-session";

function readStoredToken() {
  try {
    return window.localStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

function storeToken(token) {
  try {
    window.localStorage.setItem(SESSION_KEY, token);
  } catch {
    // see above
  }
}

function clearStoredToken() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // see above
  }
}

/**
 * The admin area: sign-in, the section tabs, and whichever page the address
 * names. Sign-in lives here so every admin page shares it.
 */
export default function AdminApp() {
  const [path, setPath] = useState(() => window.location.pathname);
  const route = adminRoute(path) || "missing";
  const page = PAGES[route];

  // `admin` is { passcode } or, for a Google admin, { token, user }.
  const [admin, setAdmin] = useState(null);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [authConfig, setAuthConfig] = useState(null);
  const [pendingNotice, setPendingNotice] = useState("");
  const [adminUsers, setAdminUsers] = useState([]);
  const [usersBusy, setUsersBusy] = useState(null);
  const [usersError, setUsersError] = useState("");

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Load the sign-in options, and pick a Google session back up after a reload.
  useEffect(() => {
    let cancelled = false;
    getAdminAuthConfig()
      .then((config) => {
        if (!cancelled) setAuthConfig(config);
      })
      .catch(() => {});
    const token = readStoredToken();
    if (token) {
      adminGetMe({ token })
        .then(({ user }) => {
          if (!cancelled) enterAdmin({ token, user });
        })
        .catch(() => clearStoredToken());
    }
    return () => {
      cancelled = true;
    };
  }, []);

  function navigate(to) {
    if (to !== window.location.pathname) window.history.pushState({}, "", to);
    setPath(to);
  }

  function enterAdmin(auth) {
    setAdmin(auth);
    setPendingNotice("");
    // Loaded here rather than on the home page, so the waiting count shows on
    // the Home tab from every page.
    loadUsers(auth);
  }

  async function unlockAdmin(e) {
    e.preventDefault();
    setAdminBusy(true);
    setAdminError("");
    try {
      const auth = { passcode: passcodeInput };
      await verifyAdmin(auth);
      setPasscodeInput("");
      enterAdmin(auth);
    } catch (err) {
      setAdminError(err.message || "Could not unlock admin.");
    } finally {
      setAdminBusy(false);
    }
  }

  // A Google account only gets in once approved; until then the backend just
  // files the request.
  async function signInWithGoogle(credential) {
    setAdminBusy(true);
    setAdminError("");
    setPendingNotice("");
    try {
      const result = await adminGoogleSignIn(credential);
      if (result.status === "approved") {
        storeToken(result.token);
        enterAdmin({ token: result.token, user: result.user });
      } else {
        setPendingNotice(
          `Thanks - your request for ${result.email} is in. An admin has to approve it before you can see anything here; sign in again once they have.`
        );
      }
    } catch (err) {
      setAdminError(err.message || "Google sign-in failed.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function loadUsers(auth) {
    setUsersError("");
    try {
      setAdminUsers(await adminListUsers(auth));
    } catch (err) {
      setUsersError(err.message || "Failed to load admin access.");
    }
  }

  async function changeUser(user, action, failure) {
    if (!admin) return;
    setUsersBusy(user.id);
    setUsersError("");
    try {
      await action(admin, user.id);
      await loadUsers(admin);
    } catch (err) {
      setUsersError(err.message || failure);
    } finally {
      setUsersBusy(null);
    }
  }

  function exitAdmin() {
    if (admin?.token) {
      adminLogout(admin).catch(() => {});
      clearStoredToken();
    }
    setAdmin(null);
    setAdminUsers([]);
    setUsersError("");
    setPasscodeInput("");
    setAdminError("");
  }

  // A Google session is unaffected; a passcode session moves to the new one.
  function onPasscodeChanged(newPasscode) {
    setAdmin((current) => (current?.token ? current : { passcode: newPasscode }));
  }

  const pendingCount = adminUsers.filter((u) => u.status === "pending").length;
  const tabs = [
    { to: "/admin", route: "home", label: pendingCount ? `Home (${pendingCount} waiting)` : "Home" },
    { to: "/admin/waiver", route: "waivers", label: "Waivers" },
    { to: "/admin/members", route: "members", label: "Members & sales" },
  ];

  let body = null;
  if (admin) {
    if (route === "home") {
      body = (
        <AdminHome
          auth={admin}
          users={adminUsers}
          usersBusy={usersBusy}
          usersError={usersError}
          onApprove={(user) => changeUser(user, adminApproveUser, "Could not approve access.")}
          onRemove={(user) => changeUser(user, adminRemoveUser, "Could not remove access.")}
          onPasscodeChanged={onPasscodeChanged}
          onNavigate={navigate}
        />
      );
    } else if (route === "waivers") {
      body = <WaiverAdmin auth={admin} />;
    } else if (route === "members") {
      body = <MembersAdmin auth={admin} />;
    } else {
      body = (
        <p className="empty-state admin-missing">
          That admin page does not exist.{" "}
          <AdminLink to="/admin" onNavigate={navigate}>
            Back to admin home
          </AdminLink>
        </p>
      );
    }
  }

  return (
    <main className="page">
      <section className="card">
        <header className="hero">
          <p className="kicker">Administration</p>
          <h1>{page.title}</h1>
          <p>{page.blurb}</p>
        </header>

        <section className="admin-shell">
          {admin ? (
            <div className="admin-live">
              <div className="admin-live-head">
                <nav className="admin-nav" aria-label="Admin sections">
                  {tabs.map((tab) => (
                    <AdminLink
                      key={tab.route}
                      to={tab.to}
                      onNavigate={navigate}
                      className={`admin-nav-link ${route === tab.route ? "is-active" : ""}`}
                      aria-current={route === tab.route ? "page" : undefined}
                    >
                      {tab.label}
                    </AdminLink>
                  ))}
                </nav>
                <div className="admin-live-actions">
                  {admin.user ? <p className="admin-who">Signed in as {admin.user.email}</p> : null}
                  <button type="button" className="ghost" onClick={exitAdmin}>
                    Exit Admin
                  </button>
                </div>
              </div>
              {body}
            </div>
          ) : (
            <div className="admin-signin">
              {authConfig?.googleClientId ? (
                <>
                  <GoogleSignIn
                    clientId={authConfig.googleClientId}
                    onCredential={signInWithGoogle}
                    onError={setAdminError}
                  />
                  <p className="admin-signin-note">
                    New Google accounts need an existing admin to approve them before they can
                    see anything.
                  </p>
                  {pendingNotice ? <p className="success">{pendingNotice}</p> : null}
                  <p className="admin-signin-divider">or use the passcode</p>
                </>
              ) : null}
              <form className="admin-login" onSubmit={unlockAdmin}>
                <label>
                  Admin Passcode
                  <input
                    type="password"
                    value={passcodeInput}
                    onChange={(e) => setPasscodeInput(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="ghost" disabled={adminBusy}>
                  {adminBusy ? "Unlocking..." : "Unlock Admin"}
                </button>
              </form>
              {adminError ? <p className="error">{adminError}</p> : null}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
