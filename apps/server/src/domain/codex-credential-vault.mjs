import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export class CodexCredentialVault {
  constructor(key) {
    this.key = normalizeKey(key);
  }

  encrypt(value, { accountId, generation, keyVersion = 1 }) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#keyFor(keyVersion), iv);
    cipher.setAAD(Buffer.from(`${accountId}:${generation}`, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return {
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  decrypt(sealed, { accountId, generation, keyVersion = 1 }) {
    const decipher = createDecipheriv("aes-256-gcm", this.#keyFor(keyVersion), Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(Buffer.from(`${accountId}:${generation}`, "utf8"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const cleartext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(cleartext.toString("utf8"));
  }

  #keyFor(version) {
    if (version === 1) return this.key;
    return createHmac("sha256", this.key).update(`codex-account-pool:data-key:v${version}`).digest();
  }
}

function normalizeKey(key) {
  const value = Buffer.isBuffer(key) ? key : Buffer.from(String(key || ""), /^[0-9a-f]{64}$/i.test(String(key || "")) ? "hex" : "base64");
  if (value.length !== 32) throw new Error("Codex credential key must be exactly 32 bytes");
  return value;
}
