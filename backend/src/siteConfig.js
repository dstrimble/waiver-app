// Gym contact details and account/sign-up links used in the waiver emails.
// Everything here is optional except the gym name and notification address:
// sections whose values are unset are simply left out of the email.
function env(name, fallback = "") {
  return String(process.env[name] || "").trim() || fallback;
}

export function getSiteConfig() {
  return {
    gymName: env("GYM_NAME", "Gravitas Mixed Martial Arts"),
    // Conversational form used in the follow-up email copy ("your free trial
    // week at Gravitas"); falls back to the full name when unset.
    gymShortName: env("GYM_SHORT_NAME"),
    notifyEmail: env("WAIVER_NOTIFY_EMAIL", "gravitasmma@gmail.com"),
    replyTo: env("MAIL_REPLY_TO"),
    websiteUrl: env("GYM_WEBSITE_URL", "https://www.gravitasmartialarts.com/"),
    signupUrl: env("SIGNUP_URL", "https://www.gravitasmartialarts.com/member-areas-4"),
    accountPortalUrl: env("ACCOUNT_PORTAL_URL"),
    scheduleUrl: env("SCHEDULE_URL"),
    // MatTracker, where members watch class videos they are tagged in. Unset
    // leaves the "Your training videos" section out of the confirmation.
    mattrackerUrl: env("MATTRACKER_URL"),
    phone: env("GYM_PHONE"),
    address: env("GYM_ADDRESS"),
  };
}
