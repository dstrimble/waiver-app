async function handle(res) {
  if (!res.ok) {
    let message = "Something went wrong.";
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }
  return res.json();
}

// Admin calls carry either a Google session token or the passcode.
function authHeaders(auth) {
  return auth?.token
    ? { Authorization: `Bearer ${auth.token}` }
    : { "x-admin-passcode": auth?.passcode || "" };
}

export function getWaiverText() {
  return fetch("/api/waivers/text").then(handle);
}

export function submitWaiver(payload) {
  return fetch("/api/waivers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function getAdminAuthConfig() {
  return fetch("/api/admin/auth/config").then(handle);
}

export function adminGoogleSignIn(credential) {
  return fetch("/api/admin/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  }).then(handle);
}

export function adminGetMe(auth) {
  return fetch("/api/admin/auth/me", { headers: authHeaders(auth) }).then(handle);
}

export function adminLogout(auth) {
  return fetch("/api/admin/auth/logout", {
    method: "POST",
    headers: authHeaders(auth),
  }).then(handle);
}

export function verifyAdmin(auth) {
  return fetch("/api/admin/verify", {
    method: "POST",
    headers: authHeaders(auth),
  }).then(handle);
}

export function adminGetWaivers(auth, { start, end, includeArchived } = {}) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (includeArchived) params.set("includeArchived", "true");
  const query = params.toString();
  return fetch(`/api/admin/waivers${query ? `?${query}` : ""}`, {
    headers: authHeaders(auth),
  }).then(handle);
}

export function adminChangePasscode(auth, payload) {
  return fetch("/api/admin/change-passcode", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth),
    },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function adminGetStats(auth) {
  return fetch("/api/admin/stats", {
    headers: authHeaders(auth),
  }).then(handle);
}

export function adminGetMembers(auth, { refresh } = {}) {
  return fetch(`/api/admin/members${refresh ? "?refresh=true" : ""}`, {
    headers: authHeaders(auth),
  }).then(handle);
}

export function adminGetConversion(auth, { refresh } = {}) {
  return fetch(`/api/admin/conversion${refresh ? "?refresh=true" : ""}`, {
    headers: authHeaders(auth),
  }).then(handle);
}

export function adminSendFollowUp(auth, id) {
  return fetch(`/api/admin/waivers/${id}/followup`, {
    method: "POST",
    headers: authHeaders(auth),
  }).then(handle);
}

export function adminArchiveWaiver(auth, id, archived) {
  return fetch(`/api/admin/waivers/${id}/${archived ? "archive" : "restore"}`, {
    method: "POST",
    headers: authHeaders(auth),
  }).then(handle);
}

export function adminListUsers(auth) {
  return fetch("/api/admin/users", { headers: authHeaders(auth) }).then(handle);
}

export function adminApproveUser(auth, id) {
  return fetch(`/api/admin/users/${id}/approve`, {
    method: "POST",
    headers: authHeaders(auth),
  }).then(handle);
}

export function adminRemoveUser(auth, id) {
  return fetch(`/api/admin/users/${id}`, {
    method: "DELETE",
    headers: authHeaders(auth),
  }).then(handle);
}
