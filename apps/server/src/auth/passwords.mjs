import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
  const value = String(password || "");
  if (value.length < 10) throw new Error("密码至少需要 10 个字符");
  const salt = randomBytes(16);
  const digest = await scrypt(value, salt, 64);
  return `scrypt:${salt.toString("hex")}:${Buffer.from(digest).toString("hex")}`;
}

export async function verifyPassword(password, encoded) {
  const [, saltHex, digestHex] = String(encoded || "").split(":");
  if (!saltHex || !digestHex) return false;
  const expected = Buffer.from(digestHex, "hex");
  const actual = Buffer.from(await scrypt(String(password || ""), Buffer.from(saltHex, "hex"), expected.length));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
