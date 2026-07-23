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

export function submitWaiver(payload) {
  return fetch("/api/waivers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function verifyAdmin(passcode) {
  return fetch("/api/admin/verify", {
    method: "POST",
    headers: { "x-admin-passcode": passcode },
  }).then(handle);
}

export function adminGetWaivers(passcode, { start, end } = {}) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const query = params.toString();
  return fetch(`/api/admin/waivers${query ? `?${query}` : ""}`, {
    headers: { "x-admin-passcode": passcode },
  }).then(handle);
}

export function adminChangePasscode(passcode, payload) {
  return fetch("/api/admin/change-passcode", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-passcode": passcode,
    },
    body: JSON.stringify(payload),
  }).then(handle);
}
