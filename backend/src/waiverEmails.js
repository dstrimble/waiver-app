import { joinNames, participantsOf, referencesOf, signerNameOf } from "./waiverPeople.js";

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

// The links block is shared by the confirmation and the one-week follow-up so
// the two emails can never offer a different set of links; only the heading
// above them changes.
function stepsText(config, heading) {
  const steps = nextSteps(config);
  if (!steps.length) {
    return [
      `To sign up for a membership or manage your account, visit ${
        config.websiteUrl || "our website"
      }.`,
      "",
    ];
  }

  const lines = [heading];
  for (const step of steps) {
    lines.push(`- ${step.label}: ${step.detail}`);
    if (step.note) lines.push(`  ${step.note}`);
  }
  lines.push("");
  return lines;
}

function stepsHtml(config, heading) {
  const steps = nextSteps(config);
  if (!steps.length) {
    return `<p style="margin:28px 0 0;">To sign up for a membership or manage your account, visit ${
      config.websiteUrl
        ? `<a href="${escapeHtml(config.websiteUrl)}" style="color:#b3261e;font-weight:600;">${escapeHtml(
            config.websiteUrl
          )}</a>`
        : "our website"
    }.</p>`;
  }

  return `<h2 style="margin:28px 0 12px;font-size:16px;">${escapeHtml(heading)}</h2>
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
       </ul>`;
}

function contactsText(config) {
  const contacts = contactLines(config);
  return contacts.length ? ["Questions?", ...contacts, ""] : [];
}

function contactsHtml(config) {
  const contacts = contactLines(config);
  if (!contacts.length) return "";
  return `<h2 style="margin:28px 0 12px;font-size:16px;">Questions?</h2>
       <p style="margin:0;color:#555;font-size:14px;">${contacts.map(escapeHtml).join("<br>")}</p>`;
}

function signOffHtml(config) {
  return `<p style="margin:28px 0 0;color:#555;font-size:14px;">See you on the mats,<br>${escapeHtml(
    config.gymName
  )}</p>`;
}

// " for yourself, Max and Ada" - or nothing when someone signed only for themselves.
function coversPhrase(submission) {
  const people = participantsOf(submission);
  if (people.length === 1 && people[0].isSigner) return "";
  return ` for ${joinNames(people.map((person) => (person.isSigner ? "yourself" : person.name)))}`;
}

// MatTracker is where class videos live, and the waiver has just set up an
// account there for this email. Only someone who trains has videos to watch:
// a parent's login does not show their children's videos, so a waiver signed
// only for children leaves this out rather than promise something MatTracker
// does not do.
function videosSection(submission, config) {
  if (!config.mattrackerUrl) return null;
  if (!participantsOf(submission).some((person) => person.isSigner)) return null;
  const email = String(submission.email || "").trim();
  return {
    heading: "Your training videos",
    url: config.mattrackerUrl,
    signIn: email ? `Sign in with Google using ${email}.` : "Sign in with Google.",
    tagged: "Once a coach tags you in a class video, it will show up there.",
    email,
  };
}

function videosText(submission, config) {
  const section = videosSection(submission, config);
  if (!section) return [];
  return [
    section.heading,
    `You now have access to MatTracker at ${section.url}, where you can watch your training videos. ${section.signIn} ${section.tagged}`,
    "",
  ];
}

function videosHtml(submission, config) {
  const section = videosSection(submission, config);
  if (!section) return "";
  const signIn = section.email
    ? `Sign in with Google using <strong>${escapeHtml(section.email)}</strong>.`
    : "Sign in with Google.";
  return `<h2 style="margin:28px 0 12px;font-size:16px;">${escapeHtml(section.heading)}</h2>
     <p style="margin:0;">You now have access to <a href="${escapeHtml(
       section.url
     )}" style="color:#b3261e;font-weight:600;">MatTracker</a>, where you can watch your training videos. ${signIn} ${escapeHtml(
       section.tagged
     )}</p>`;
}

/** Confirmation for the person who signed, with their waiver PDF attached. */
export function buildMemberEmail(submission, config) {
  const greeting = firstName(signerNameOf(submission));
  const thanks = `Thanks for signing the waiver at ${config.gymName}${coversPhrase(submission)}.`;
  const textParts = [
    `Hi ${greeting},`,
    "",
    `${thanks} A PDF copy is attached for your records.`,
    "",
    ...videosText(submission, config),
    ...stepsText(config, "Getting started"),
    ...contactsText(config),
    `See you on the mats,`,
    config.gymName,
  ];

  const html = htmlShell(
    config.gymName,
    `<h1 style="margin:0 0 16px;font-size:22px;">Your waiver is on file</h1>
     <p style="margin:0 0 12px;">Hi ${escapeHtml(greeting)},</p>
     <p style="margin:0;">${escapeHtml(thanks)} A PDF copy is attached for your records.</p>
     ${videosHtml(submission, config)}
     ${stepsHtml(config, "Getting started")}
     ${contactsHtml(config)}
     ${signOffHtml(config)}`
  );

  return {
    subject: `Your signed waiver - ${config.gymName}`,
    text: textParts.join("\n"),
    html,
  };
}

/**
 * Sent a week after signing, once the trial week is behind them: asks how the
 * week went and invites them to join, carrying the same links as the
 * confirmation email so nothing they were given up front goes missing.
 */
export function buildFollowUpEmail(submission, config) {
  const shortName = config.gymShortName || config.gymName;

  const pitch =
    `How did you enjoy your free trial week at ${shortName}? We would love to hear about ` +
    `your experience and have you onboard as a member. Sign up is easy! Let us be a part ` +
    `of your fitness journey today.`;

  const textParts = [
    `Hi ${firstName(submission.name)},`,
    "",
    pitch,
    "",
    ...stepsText(config, "Ready to join?"),
    ...contactsText(config),
    `See you on the mats,`,
    config.gymName,
  ];

  const html = htmlShell(
    config.gymName,
    `<h1 style="margin:0 0 16px;font-size:22px;">How was your free trial week?</h1>
     <p style="margin:0 0 12px;">Hi ${escapeHtml(firstName(submission.name))},</p>
     <p style="margin:0;">${escapeHtml(pitch)}</p>
     ${stepsHtml(config, "Ready to join?")}
     ${contactsHtml(config)}
     ${signOffHtml(config)}`
  );

  return {
    subject: `How was your free trial week at ${shortName}?`,
    text: textParts.join("\n"),
    html,
  };
}

/** Internal notification to the gym, with the same PDF attached. */
export function buildGymEmail(submission, config) {
  const people = participantsOf(submission);
  const signerName = signerNameOf(submission);
  const signerTrains = people.some((person) => person.isSigner);
  const rows = [
    [signerTrains ? "Name" : "Signed by (parent / guardian)", signerName],
    ["Email", submission.email],
    ["Cell", submission.cellPhone],
    ...people.map((person, index) => [
      people.length > 1 ? `Participant ${index + 1}` : "Participant",
      [
        person.isSigner ? `${person.name} (signer)` : person.name,
        person.dateOfBirth ? `born ${person.dateOfBirth}` : "",
        (Array.isArray(person.interests) ? person.interests : []).join(", "),
      ]
        .filter(Boolean)
        .join(" - "),
    ]),
    ["Heard About Us", submission.heardAbout],
    ["Looking For", submission.lookingFor],
  ];
  const reference = referencesOf(submission);
  const who = joinNames(people.map((person) => person.name));

  const text = [
    `New waiver signed at ${config.gymName}.`,
    "",
    ...rows.map(([label, value]) => `${label}: ${fallback(value)}`),
    "",
    `Reference: ${reference}`,
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
     <p style="margin:24px 0 0;color:#555;font-size:14px;">Reference ${escapeHtml(
       reference
     )}. The signed waiver PDF is attached.</p>`
  );

  return {
    subject: `New waiver: ${fallback(who)}${signerTrains ? "" : ` (signed by ${signerName})`}`,
    text,
    html,
  };
}
