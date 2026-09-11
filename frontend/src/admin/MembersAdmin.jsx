import { useEffect, useState } from "react";
import { adminGetMembers } from "../api.js";
import MembersSection from "../components/Members.jsx";

/** Membership page: members and sales from Squarespace, nothing from the waivers. */
export default function MembersAdmin({ auth }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(refresh = false) {
    setLoading(true);
    setError("");
    try {
      setData(await adminGetMembers(auth, { refresh }));
    } catch (err) {
      setError(err.message || "Failed to load Squarespace data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [auth]);

  return <MembersSection data={data} loading={loading} error={error} onRefresh={() => load(true)} />;
}
