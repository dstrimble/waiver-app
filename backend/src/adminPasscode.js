import crypto from "crypto";

const ITERATIONS = 120000;
const KEYLEN = 64;
const DIGEST = "sha512";

function pbkdf2Async(passcode, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(passcode, salt, ITERATIONS, KEYLEN, DIGEST, (err, derived) => {
      if (err) return reject(err);
      return resolve(derived.toString("hex"));
    });
  });
}

export async function hashPasscode(passcode) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digestHex = await pbkdf2Async(passcode, salt);
  return `${salt}:${digestHex}`;
}

export async function verifyPasscode(passcode, storedHash) {
  if (!storedHash || !passcode) return false;
  const [salt, expected] = String(storedHash).split(":");
  if (!salt || !expected) return false;
  const actual = await pbkdf2Async(passcode, salt);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
