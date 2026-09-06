// Local SMTP server stand-in for acceptance tests.
//
//   import { startSmtpMock } from "./smtp-mock.mjs";
//   const mock = await startSmtpMock({ port: 3120, credentials: { username, password } });
//
// It is a *protocol* mock, not a shortcut: it speaks real SMTP over a real socket with a
// strict state machine (commands out of order are refused with 503), it really checks the
// AUTH credentials, it really collects the DATA payload, and it can really refuse a
// recipient, stall or fail. A message that never arrived is therefore never reported as
// sent by the mailer under test.
//
// Standalone: node scripts/smtp-mock.mjs

import net from "node:net";
import tls from "node:tls";

const CRLF = "\r\n";

/** Split a raw RFC 5322 message into headers plus decoded text. */
export function parseMessage(raw) {
  const normalized = raw.replace(/\r?\n/g, "\r\n");
  const split = normalized.indexOf("\r\n\r\n");
  const head = split >= 0 ? normalized.slice(0, split) : normalized;
  const body = split >= 0 ? normalized.slice(split + 4) : "";
  const headers = {};
  for (const line of head.split("\r\n")) {
    const index = line.indexOf(":");
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  const text = (headers["content-transfer-encoding"] || "").toLowerCase() === "base64"
    ? Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8")
    : body;
  let subject = headers.subject || "";
  const encoded = /=\?UTF-8\?B\?(.+)\?=/i.exec(subject);
  if (encoded) subject = Buffer.from(encoded[1], "base64").toString("utf8");
  return { headers, subject, text, raw: normalized };
}

/**
 * @param {object} [options]
 * @param {number} [options.port] 0 picks a free port
 * @param {{cert:string,key:string}|null} [options.tls] implicit TLS (port 465 style)
 * @param {boolean} [options.starttls] advertise STARTTLS on the plain connection
 * @param {{username:string,password:string}|null} [options.credentials] require AUTH
 * @param {string[]} [options.mechanisms] advertised AUTH mechanisms
 * @param {object} [options.behaviour] fault injection: greetingCode, authCode, rcptCode, dataCode, stall
 */
export async function startSmtpMock(options = {}) {
  const {
    port = 0,
    tls: tlsMaterial = null,
    starttls = false,
    credentials = null,
    mechanisms = ["LOGIN", "PLAIN"],
    behaviour = {},
  } = options;

  const state = {
    messages: [],
    connections: 0,
    tlsUpgrades: 0,
    authAttempts: [],
    refusals: [],
  };

  function handle(initialSocket, initiallySecure) {
    state.connections += 1;
    let active = initialSocket;
    let buffer = "";
    let stage = "greeting";
    let secured = initiallySecure;
    let dataLines = null;
    let envelope = null;
    let authenticated = null;
    let pendingAuth = null;
    let closed = false;

    const reply = lines => {
      if (closed || active.destroyed) return;
      active.write(lines.map(line => `${line}${CRLF}`).join(""));
    };
    const refuse = (code, text) => {
      state.refusals.push({ code, text, stage });
      reply([`${code} ${text}`]);
    };
    const ehloReply = () => {
      const capabilities = ["mock.wanke.local", "PIPELINING", "8BITMIME"];
      if (starttls && !secured && tlsMaterial) capabilities.push("STARTTLS");
      if (credentials) capabilities.push(`AUTH ${mechanisms.join(" ")}`);
      // The last line of a multiline reply uses "250 " (space); the others use "250-".
      reply(capabilities.map((item, index) => `${index === capabilities.length - 1 ? "250 " : "250-"}${item}`));
    };

    function attach(socket) {
      active = socket;
      socket.setEncoding("utf8");
      socket.on("data", chunk => onData(String(chunk)));
      socket.on("error", () => { /* a refused connection is a legitimate test outcome */ });
      socket.on("close", () => { closed = true; });
    }

    function finishData() {
      const raw = dataLines.join(CRLF);
      dataLines = null;
      if (behaviour.dataCode && behaviour.dataCode !== 250) {
        stage = "rcpt";
        envelope = null;
        return refuse(behaviour.dataCode, "message rejected");
      }
      state.messages.push({
        ...parseMessage(`${raw}${CRLF}`),
        envelope: envelope ? { from: envelope.from, to: [...envelope.to] } : null,
        secured,
        authenticated: Boolean(authenticated),
        receivedAt: new Date().toISOString(),
      });
      reply([`250 OK: queued as ${String(state.messages.length).padStart(4, "0")}`]);
      stage = "rcpt";
      envelope = null;
    }

    function onData(chunk) {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf(CRLF);
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (closed) return;
        if (dataLines !== null) {
          if (line === ".") finishData();
          else dataLines.push(line.replace(/^\.\./, "."));
          continue;
        }
        const trimmed = line.trim();
        if (!trimmed) continue;
        handleLine(trimmed);
      }
    }

    function handleLine(line) {
      if (pendingAuth) {
        const handler = pendingAuth;
        pendingAuth = null;
        handler(line);
        return;
      }
      const verb = line.split(" ")[0].toUpperCase();
      const argument = line.slice(verb.length).trim();

      if (verb === "EHLO" || verb === "HELO") {
        stage = "ehlo";
        envelope = null;
        if (verb === "EHLO") ehloReply();
        else reply(["250 mock.wanke.local"]);
        return;
      }
      if (verb === "QUIT") { reply(["221 Bye"]); closed = true; active.end(); return; }
      if (verb === "NOOP") { reply(["250 OK"]); return; }
      if (verb === "RSET") { stage = "ehlo"; envelope = null; reply(["250 OK"]); return; }
      if (verb === "STARTTLS") {
        if (stage !== "ehlo") return refuse(503, "send EHLO first");
        if (secured || !starttls || !tlsMaterial) return refuse(502, "STARTTLS not available");
        reply(["220 Ready to start TLS"]);
        const plain = active;
        plain.removeAllListeners("data");
        const secure = new tls.TLSSocket(plain, { isServer: true, key: tlsMaterial.key, cert: tlsMaterial.cert });
        secure.once("secure", () => {
          state.tlsUpgrades += 1;
          secured = true;
          stage = "greeting";
          buffer = "";
          attach(secure);
        });
        secure.on("error", () => { closed = true; });
        return;
      }
      if (stage !== "ehlo" && stage !== "authed" && stage !== "mail" && stage !== "rcpt") {
        return refuse(503, "send EHLO first");
      }

      if (verb === "AUTH") {
        if (!credentials) return refuse(503, "AUTH not required");
        const mechanism = argument.split(" ")[0].toUpperCase();
        const inline = argument.split(" ").slice(1).join(" ");
        if (!mechanisms.includes(mechanism)) return refuse(504, "unsupported authentication mechanism");
        const finish = (user, pass) => {
          const ok = user === credentials.username && pass === credentials.password;
          state.authAttempts.push({ mechanism, user, ok });
          if (!ok) {
            stage = "ehlo";
            envelope = null;
            return refuse(behaviour.authCode || 535, "Authentication failed");
          }
          stage = "authed";
          authenticated = mechanism;
          reply(["235 Authentication successful"]);
        };
        if (mechanism === "PLAIN") {
          if (!inline) {
            reply(["334 "]);
            pendingAuth = value => {
              const parts = Buffer.from(value.trim(), "base64").toString("utf8").split("\u0000");
              finish(parts[1] ?? "", parts[2] ?? "");
            };
            return;
          }
          const parts = Buffer.from(inline, "base64").toString("utf8").split("\u0000");
          finish(parts[1] ?? "", parts[2] ?? "");
          return;
        }
        // AUTH LOGIN: two base64 challenges.
        reply(["334 " + Buffer.from("Username:").toString("base64")]);
        pendingAuth = usernameLine => {
          const user = Buffer.from(usernameLine.trim(), "base64").toString("utf8");
          reply(["334 " + Buffer.from("Password:").toString("base64")]);
          pendingAuth = passwordLine => {
            finish(user, Buffer.from(passwordLine.trim(), "base64").toString("utf8"));
          };
        };
        return;
      }

      if (verb === "MAIL") {
        if (stage !== "ehlo" && stage !== "authed" && stage !== "rcpt") return refuse(503, "unexpected MAIL");
        if (credentials && !authenticated) return refuse(530, "authentication required");
        const from = /<([^>]*)>/.exec(argument)?.[1] ?? argument;
        envelope = { from, to: [] };
        stage = "mail";
        reply(["250 OK"]);
        return;
      }
      if (verb === "RCPT") {
        if (stage !== "mail" && stage !== "rcpt") return refuse(503, "need MAIL first");
        if (behaviour.rcptCode && behaviour.rcptCode !== 250) return refuse(behaviour.rcptCode, "recipient rejected");
        const to = /<([^>]*)>/.exec(argument)?.[1] ?? argument;
        envelope.to.push(to);
        stage = "rcpt";
        reply(["250 Accepted"]);
        return;
      }
      if (verb === "DATA") {
        if (stage !== "rcpt" || !envelope?.to?.length) return refuse(503, "need RCPT first");
        if (behaviour.stall === "data") return; // never answer: the client must time out
        reply(["354 End data with <CR><LF>.<CR><LF>"]);
        dataLines = [];
        buffer = "";
        return;
      }
      refuse(500, "unrecognized command");
    }

    attach(initialSocket);
    if (behaviour.greetingCode && behaviour.greetingCode !== 220) {
      reply([`${behaviour.greetingCode} service unavailable`]);
      closed = true;
      initialSocket.end();
      return;
    }
    if (behaviour.stall === "greeting") return;
    reply(["220 mock.wanke.local ESMTP ready"]);
  }

  const server = tlsMaterial && !starttls
    ? tls.createServer({ key: tlsMaterial.key, cert: tlsMaterial.cert }, socket => handle(socket, true))
    : net.createServer(socket => handle(socket, false));

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();

  return {
    port: typeof address === "object" && address ? address.port : port,
    host: "127.0.0.1",
    state,
    get messages() { return state.messages; },
    /** Drop per-message state only: AUTH statistics stay cumulative for the whole run. */
    reset() {
      state.messages.length = 0;
      state.refusals.length = 0;
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = await startSmtpMock({
    port: Number(process.env.E2E_SMTP_PORT || 3120),
    credentials: { username: "mock", password: "mock-password" },
  });
  console.log(`SMTP mock listening on 127.0.0.1:${mock.port}`);
  console.log("后台 → 系统设置 → 邮件：地址 127.0.0.1、端口如上、账号 mock、密码 mock-password");
  const stop = () => { mock.close().then(() => process.exit(0)); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
