// One submission can cover a parent and their children: a signer, and the
// people who will train. The one-person shape (a name, and a parent's name
// when a parent signed) is still passed around by older code paths and tests,
// so these read either.

/** The people a submission covers, each with `isSigner` for whoever signed. */
export function participantsOf(submission) {
  if (Array.isArray(submission.participants) && submission.participants.length) {
    return submission.participants;
  }
  return [
    {
      id: submission.id,
      name: submission.name,
      dateOfBirth: submission.dateOfBirth,
      interests: Array.isArray(submission.interests) ? submission.interests : [],
      isSigner: !submission.parentName,
    },
  ];
}

/** Who signed: the parent when one signed for a child, otherwise the person. */
export function signerNameOf(submission) {
  return submission.signerName || submission.parentName || submission.name || "";
}

/** "Max", "Max and Ada", "Max, Ada and Sam". */
export function joinNames(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** "#21, #22, #23" - the waiver ids a submission was stored under. */
export function referencesOf(submission) {
  const ids = Array.isArray(submission.ids) ? submission.ids : [submission.id];
  return ids.filter((id) => id !== null && id !== undefined).map((id) => `#${id}`).join(", ") || "-";
}
