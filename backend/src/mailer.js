import nodemailer from "nodemailer";

// SMTP settings match the spartracker deployment so the same Gmail app
// password works for both apps without a second credential to manage.
export function getMailerConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const sender = String(process.env.SMTP_FROM || "").trim();

  return {
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    user: String(process.env.SMTP_USER || "").trim(),
    password: String(process.env.SMTP_PASSWORD || "").trim(),
    sender,
    startTls: ["1", "true", "yes", "on"].includes(
      String(process.env.SMTP_STARTTLS ?? "true").toLowerCase()
    ),
    // Host and sender are the minimum; an unauthenticated relay needs no user.
    enabled: Boolean(host && sender),
  };
}

export function isMailerConfigured() {
  return getMailerConfig().enabled;
}

let cachedTransport = null;
let cachedKey = "";

function getTransport(config) {
  // Reuse one pooled transport, but rebuild it if the settings change.
  const key = JSON.stringify([config.host, config.port, config.user, config.startTls]);
  if (cachedTransport && cachedKey === key) return cachedTransport;

  cachedTransport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // Port 465 is implicit TLS; everything else upgrades with STARTTLS.
    secure: config.port === 465,
    requireTLS: config.port !== 465 && config.startTls,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    pool: true,
    maxConnections: 2,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
  cachedKey = key;
  return cachedTransport;
}

// Exported for tests and for picking up rotated credentials.
export function resetMailerTransport() {
  if (cachedTransport) cachedTransport.close();
  cachedTransport = null;
  cachedKey = "";
}

/**
 * Send one message over SMTP.
 *
 * @param {object} message
 * @param {string|string[]} message.to
 * @param {string} message.subject
 * @param {string} message.text
 * @param {string} [message.html]
 * @param {string} [message.replyTo]
 * @param {Array<{filename: string, content: Buffer, contentType?: string}>} [message.attachments]
 * @returns {Promise<{messageId: string, accepted: string[], rejected: string[]}>}
 */
export async function sendMail(message) {
  const config = getMailerConfig();
  if (!config.enabled) {
    throw new Error("SMTP is not configured. Set SMTP_HOST and SMTP_FROM.");
  }

  const info = await getTransport(config).sendMail({
    from: config.sender,
    to: message.to,
    replyTo: message.replyTo || undefined,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments,
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
  };
}
