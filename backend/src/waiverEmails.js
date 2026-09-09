function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(fullName) {
  const first = String(fullName || "").trim().split(/\s+/)[0];
  return first || "there";
}

function fallback(value) {
  const text = String(value ?? "").trim();
  return text || "-";
}

function htmlShell(gymName, bodyHtml) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.55;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px;">
    <p style="margin:0 0 20px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#777;">${escapeHtml(
      gymName
    )}</p>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

// Renders "Getting started" only for the links/details that are configured,
// so an unset SIGNUP_URL simply drops that line rather than emitting a stub.
function nextSteps(config) {
  const items = [];
  if (config.signupUrl) {
    items.push({
      label: "Sign up for a membership",
      detail: config.signupUrl,
      href: config.signupUrl,
    });
  }
  if (config.accountPortalUrl) {
    items.push({
      label: "Manage your account",
      detail: config.accountPortalUrl,
      href: config.accountPortalUrl,
      note: "Update billing, contact details, and membership settings.",
    });
  }
  if (config.scheduleUrl) {
    items.push({
      label: "Class schedule",
      detail: config.scheduleUrl,
      href: config.scheduleUrl,
    });
  }
  return items;
}

function contactLines(config) {
  const lines = [];
  if (config.phone) lines.push(`Phone: ${config.phone}`);
  if (config.address) lines.push(`Address: ${config.address}`);
  if (config.websiteUrl) lines.push(`Website: ${config.websiteUrl}`);
  if (config.notifyEmail) lines.push(`Email: ${config.notifyEmail}`);
  return lines;
}

/** Confirmation for the person who signed, with their waiver PDF attached. */
export function buildMemberEmail(submission, config) {
  const steps = nextSteps(config);
  const contacts = contactLines(config);

  const textParts = [
    `Hi ${firstName(submission.name)},`,
    "",
    `Thanks for signing the waiver at ${config.gymName}. A PDF copy is attached for your records.`,
    "",
  ];

  if (steps.length) {
    textParts.push("Getting started");
    for (const step of steps) {
      textParts.push(`- ${step.label}: ${step.detail}`);
      if (step.note) textParts.push(`  ${step.note}`);
    }
    textParts.push("");
  } else {
    textParts.push(
      `To sign up for a membership or manage your account, visit ${
        config.websiteUrl || "our website"
      }.`,
      ""
    );
  }

  if (contacts.length) {
    textParts.push("Questions?", ...contacts, "");
  }
  textParts.push(`See you on the mats,`, config.gymName);

  const stepsHtml = steps.length
    ? `<h2 style="margin:28px 0 12px;font-size:16px;">Getting started</h2>
       <ul style="margin:0;padding-left:20px;">
         ${steps
           .map(
             (step) => `<li style="margin-bottom:10px;">
               <a href="${escapeHtml(step.href)}" style="color:#b3261e;font-weight:600;">${escapeHtml(
               step.label
             )}</a>${
               step.note
                 ? `<br><span style="color:#555;font-size:14px;">${escapeHtml(step.note)}</span>`
                 : ""
             }
             </li>`
           )
           .join("")}
       </ul>`
    : `<p style="margin:28px 0 0;">To sign up for a membership or manage your account, visit ${
        config.websiteUrl
          ? `<a href="${escapeHtml(config.websiteUrl)}" style="color:#b3261e;font-weight:600;">${escapeHtml(
              config.websiteUrl
            )}</a>`
          : "our website"
      }.</p>`;

  const contactsHtml = contacts.length
    ? `<h2 style="margin:28px 0 12px;font-size:16px;">Questions?</h2>
       <p style="margin:0;color:#555;font-size:14px;">${contacts.map(escapeHtml).join("<br>")}</p>`
    : "";

  const html = htmlShell(
    config.gymName,
    `<h1 style="margin:0 0 16px;font-size:22px;">Your waiver is on file</h1>
     <p style="margin:0 0 12px;">Hi ${escapeHtml(firstName(submission.name))},</p>
     <p style="margin:0;">Thanks for signing the waiver at ${escapeHtml(
       config.gymName
     )}. A PDF copy is attached for your records.</p>
     ${stepsHtml}
     ${contactsHtml}
     <p style="margin:28px 0 0;color:#555;font-size:14px;">See you on the mats,<br>${escapeHtml(
       config.gymName
     )}</p>`
  );

  return {
    subject: `Your signed waiver - ${config.gymName}`,
    text: textParts.join("\n"),
    html,
  };
}

/** Internal notification to the gym, with the same PDF attached. */
export function buildGymEmail(submission, config) {
  const interests = Array.isArray(submission.interests) ? submission.interests : [];
  const rows = [
    ["Name", submission.name],
    ["Email", submission.email],
    ["Cell", submission.cellPhone],
    ["Date of Birth", submission.dateOfBirth],
    ["Parent / Guardian", submission.parentName],
    ["Interested In", interests.join(", ")],
    ["Heard About Us", submission.heardAbout],
    ["Looking For", submission.lookingFor],
  ];

  const text = [
    `New waiver signed at ${config.gymName}.`,
    "",
    ...rows.map(([label, value]) => `${label}: ${fallback(value)}`),
    "",
    `Reference: #${submission.id ?? "-"}`,
    "The signed waiver PDF is attached.",
  ].join("\n");

  const html = htmlShell(
    config.gymName,
    `<h1 style="margin:0 0 16px;font-size:22px;">New waiver signed</h1>
     <table style="width:100%;border-collapse:collapse;font-size:14px;">
       ${rows
         .map(
           ([label, value]) => `<tr>
             <td style="padding:6px 12px 6px 0;color:#777;vertical-align:top;white-space:nowrap;">${escapeHtml(
               label
             )}</td>
             <td style="padding:6px 0;vertical-align:top;">${escapeHtml(fallback(value))}</td>
           </tr>`
         )
         .join("")}
     </table>
     <p style="margin:24px 0 0;color:#555;font-size:14px;">Reference #${escapeHtml(
       submission.id ?? "-"
     )}. The signed waiver PDF is attached.</p>`
  );

  return {
    subject: `New waiver: ${fallback(submission.name)}`,
    text,
    html,
  };
}
