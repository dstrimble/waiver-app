function formatDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

/**
 * Who can use the admin page by Google sign-in. Requests wait here until an
 * admin approves them; denying a request or removing an admin deletes the
 * account, and they can always ask again.
 */
export default function AdminUsers({ users, currentUserId, busyId, onApprove, onRemove }) {
  const pending = users.filter((u) => u.status === "pending");
  const approved = users.filter((u) => u.status === "approved");

  return (
    <section id="admin-access-panel" className="admin-access" aria-label="Admin access">
      <h3>Waiting for approval</h3>
      {pending.length ? (
        <ul className="admin-user-list">
          {pending.map((user) => (
            <li key={user.id}>
              <div>
                <strong>{user.name || user.email}</strong>
                <span>
                  {user.email} · asked {formatDate(user.created_at)}
                </span>
              </div>
              <div className="admin-user-actions">
                <button
                  type="button"
                  className="viz-toggle"
                  disabled={busyId === user.id}
                  onClick={() => onApprove(user)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busyId === user.id}
                  onClick={() => onRemove(user)}
                >
                  Deny
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">No one is waiting for access.</p>
      )}

      <h3>Admins signed in with Google</h3>
      {approved.length ? (
        <ul className="admin-user-list">
          {approved.map((user) => {
            const isYou = String(user.id) === String(currentUserId);
            return (
              <li key={user.id}>
                <div>
                  <strong>
                    {user.name || user.email}
                    {isYou ? " (you)" : ""}
                  </strong>
                  <span>
                    {user.email}
                    {user.approved_by ? ` · approved by ${user.approved_by}` : ""}
                  </span>
                </div>
                <div className="admin-user-actions">
                  <button
                    type="button"
                    className="danger"
                    disabled={isYou || busyId === user.id}
                    title={isYou ? "Another admin has to remove you." : "Remove admin access"}
                    onClick={() => onRemove(user)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty-state">No Google admins yet. The passcode still works.</p>
      )}
    </section>
  );
}
