const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } = require("node:crypto");

const envPath = path.resolve(process.argv[2] || ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("Env file not found:", envPath);
  process.exit(1);
}

const envText = fs.readFileSync(envPath, "utf8");
const authSecretMatch = envText.match(/AUTH_SECRET=([^\r\n]+)/);
const authSecret = authSecretMatch ? authSecretMatch[1].trim() : "";
if (!authSecret) {
  console.error("AUTH_SECRET not found in", envPath);
  process.exit(1);
}

const key = scryptSync(authSecret.normalize("NFKC"), "wanke-master:configured", 32);
const id = createHash("sha256").update(key).digest("hex").slice(0, 8);

function encrypt(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["enc:v1", id, iv.toString("hex"), tag.toString("hex"), ciphertext.toString("hex")].join(":");
}

function decrypt(stored) {
  const parts = stored.split(":");
  const [, , sealedKeyId, ivHex, tagHex, cipherHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(cipherHex, "hex")), decipher.final()]).toString("utf8");
}

const NEW_API_KEY = "sk-ws-H.EPYLHIX.gTOC.MEUCIQDUAHYsbkb8IOyNl1Sx6VyWEaOx0s6v-dSSBnlLQsWSkQIgC8gb7gQYII46MuNgmUivZh1s9G0AHh6lPxfyASKu4ZQ";
const NEW_BASE_URL = "https://ws-z77q317bngeiixd0.cn-beijing.maas.aliyuncs.com/api/v1";
const NEW_WS_ID = "ws-z77q317bngeiixd0";

const dbPath = path.resolve(process.argv[3] || "data/wanke.db");
const targetChannel = (process.argv[4] || "wan").toLowerCase(); // "wan" | "happyhorse" | "common"
const db = new Database(dbPath);
const now = new Date().toISOString();

const encKey = encrypt(NEW_API_KEY);

const prefix = targetChannel === "wan" ? "wan" : targetChannel === "happyhorse" ? "happyhorse" : "modelstudio";
const secretKeyName = `${prefix}_api_key`;
const baseUrlKeyName = `${prefix}_base_url`;
const wsIdKeyName = `${prefix}_workspace_id`;

console.log(`Writing credentials for channel: [${targetChannel}] (keys: ${secretKeyName}, ${baseUrlKeyName}, ${wsIdKeyName})`);

const stmtSecret = db.prepare(`
  INSERT INTO "secrets" ("key", "ciphertext", "updated_at")
  VALUES (?, ?, ?)
  ON CONFLICT("key") DO UPDATE SET "ciphertext" = excluded.ciphertext, "updated_at" = excluded.updated_at
`);
stmtSecret.run(secretKeyName, encKey, now);

const stmtSetting = db.prepare(`
  INSERT INTO "settings" ("key", "value", "updated_at")
  VALUES (?, ?, ?)
  ON CONFLICT("key") DO UPDATE SET "value" = excluded.value, "updated_at" = excluded.updated_at
`);
stmtSetting.run(baseUrlKeyName, NEW_BASE_URL, now);
stmtSetting.run(wsIdKeyName, NEW_WS_ID, now);

// Remove plain text credential if any
db.prepare(`DELETE FROM "settings" WHERE "key" = ?`).run(secretKeyName);

// Verification
const savedSecret = db.prepare(`SELECT "ciphertext" FROM "secrets" WHERE "key" = ?`).get(secretKeyName);
const decrypted = decrypt(savedSecret.ciphertext);
console.log("Decrypted API Key verify match:", decrypted === NEW_API_KEY);

const allSettings = db.prepare(`SELECT "key", "value" FROM "settings"`).all();
console.log("Current settings:", allSettings);
