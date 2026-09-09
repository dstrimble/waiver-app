// Gym contact details and account/sign-up links used in the waiver emails.
// Everything here is optional except the gym name and notification address:
// sections whose values are unset are simply left out of the email.
function env(name, fallback = "") {
  return String(process.env[name] || "").trim() || fallback;
}

export function getSiteConfig() {
  return {
    gymName: env("GYM_NAME", "Gravitas Mixed Martial Arts"),
    notifyEmail: env("WAIVER_NOTIFY_EMAIL", "gravitasmma@gmail.com"),
    replyTo: env("MAIL_REPLY_TO"),
    websiteUrl: env("GYM_WEBSITE_URL"),
    signupUrl: env("SIGNUP_URL"),
    accountPortalUrl: env("ACCOUNT_PORTAL_URL"),
    scheduleUrl: env("SCHEDULE_URL"),
    phone: env("GYM_PHONE"),
    address: env("GYM_ADDRESS"),
  };
}
