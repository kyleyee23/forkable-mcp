// `--auth` CLI: import a Forkable session (password login or a "Copy as cURL" blob), then exit.

import { ingestCredentials } from "./ingest.ts";
import { loginWithPassword } from "./login.ts";
import { readSession, redact } from "./session.ts";
import { ReauthRequiredError } from "@/net/errors.ts";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";

async function readStdin(input: NodeJS.ReadStream = process.stdin): Promise<string> {
  input.setEncoding("utf8");
  let value = "";
  for await (const chunk of input) value += chunk;
  return value;
}

const authOptions = {
  auth: { type: "boolean" },
  login: { type: "boolean" },
  file: { type: "string" },
  email: { type: "string" },
  mfa: { type: "string" },
  "password-stdin": { type: "boolean" },
} as const;

function parseAuthCliArgs(argv: string[]) {
  if (argv.some((arg) => arg === "--password" || arg.startsWith("--password="))) {
    throw new Error(
      "--password is not supported because command-line arguments can expose secrets. " +
        "Use the hidden prompt, --password-stdin, or FORKABLE_PASSWORD.",
    );
  }

  const { values } = parseArgs({ args: argv, options: authOptions, strict: true });
  if (values["password-stdin"] && !values.login) {
    throw new Error("--password-stdin requires --login.");
  }
  return values;
}

export function validateAuthCliArgs(argv: string[]): void {
  parseAuthCliArgs(argv);
}

export async function promptHiddenPassword(
  input: NodeJS.ReadStream = process.stdin,
  output: Pick<NodeJS.WriteStream, "write"> = process.stderr,
): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error(
      "No interactive terminal available; use --password-stdin or FORKABLE_PASSWORD.",
    );
  }

  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const readline = createInterface({ input, output: muted, terminal: true });
  const abort = new AbortController();
  const cancel = (_value: string, key: { ctrl?: boolean; name?: string; sequence?: string }) => {
    if (
      (key.ctrl && (key.name === "c" || key.name === "d")) ||
      key.sequence?.endsWith("\u0003") ||
      key.sequence?.endsWith("\u0004")
    ) {
      abort.abort();
    }
  };
  input.on("keypress", cancel);
  output.write("Password: ");
  try {
    const password = await readline.question("", { signal: abort.signal });
    if (!password) throw new Error("Password cannot be empty.");
    return password;
  } catch (error) {
    if (abort.signal.aborted) throw new Error("Password prompt canceled.", { cause: error });
    throw error;
  } finally {
    input.off("keypress", cancel);
    readline.close();
    output.write("\n");
  }
}

interface PasswordSources {
  envPassword?: string | null;
  stdinIsTTY?: boolean;
  readStdin?: () => Promise<string>;
  prompt?: () => Promise<string>;
}

export async function resolveLoginPassword(
  passwordStdin: boolean,
  sources: PasswordSources = {},
): Promise<string> {
  if (passwordStdin) {
    const raw = await (sources.readStdin ?? (() => readStdin()))();
    const password = raw.replace(/\r?\n$/, "");
    if (!password) throw new Error("No password was provided on stdin.");
    return password;
  }

  const envPassword = Object.hasOwn(sources, "envPassword")
    ? sources.envPassword
    : process.env.FORKABLE_PASSWORD;
  if (envPassword) return envPassword;

  const stdinIsTTY = sources.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  if (!stdinIsTTY) {
    throw new Error(
      "No password provided. Use --password-stdin or set FORKABLE_PASSWORD in a non-interactive environment.",
    );
  }
  return (sources.prompt ?? (() => promptHiddenPassword()))();
}

export async function runAuthCli(argv: string[]): Promise<void> {
  try {
    const args = parseAuthCliArgs(argv);
    if (args.login) {
      // Headless password login.
      const email = args.email ?? process.env.FORKABLE_EMAIL;
      const mfaCode = args.mfa ?? process.env.FORKABLE_MFA;
      if (!email) {
        console.error("Provide --email or set FORKABLE_EMAIL.");
        process.exit(1);
      }
      const password = await resolveLoginPassword(args["password-stdin"] ?? false);
      const { me } = await loginWithPassword({ email, password, mfaCode });
      console.error(`✓ Logged in as ${me.fullName || me.email || `user ${me.id}`}.`);
    } else if (!args.file && process.env.FORKABLE_COOKIE) {
      // Headless cookie import.
      const { me } = await ingestCredentials({
        cookie: process.env.FORKABLE_COOKIE,
        csrf: process.env.FORKABLE_CSRF,
      });
      console.error(
        `✓ Stored session from FORKABLE_COOKIE for ${me.fullName || me.email || `user ${me.id}`}.`,
      );
    } else {
      const blob = args.file ? await readFile(args.file, "utf8") : await readStdin();
      if (!blob.trim()) {
        console.error(
          "No session provided. Pick whichever is easiest:\n" +
            "\n" +
            "  1. Email + password (works headless, auto-refreshes):\n" +
            "       forkable-mcp --auth --login --email you@co.com\n" +
            "     The terminal prompts without echoing. For non-interactive use:\n" +
            "       printf '%s\\n' \"$FORKABLE_PASSWORD\" | forkable-mcp --auth --login --email you@co.com --password-stdin\n" +
            "\n" +
            "  2. Paste a cookie header (SSO accounts):\n" +
            "       FORKABLE_COOKIE='_easyorder_session=…; …' forkable-mcp --auth\n" +
            "     Get it from forkable.com → DevTools (⌥⌘I) → Network → filter for\n" +
            "     `graphql` → click a POST /api/v2/graphql request → Headers → Request Headers\n" +
            "     → copy the whole `cookie:` value (must include _easyorder_session).\n" +
            "\n" +
            '  3. Paste a "Copy as cURL" blob — the whole curl command DevTools writes\n' +
            "     for a request, cookies and all; we just parse the cookie out of it.\n" +
            "     forkable.com → DevTools → Network → filter for `graphql` →\n" +
            "     right-click a POST /api/v2/graphql request → Copy → Copy as cURL, then:\n" +
            "       pbpaste | forkable-mcp --auth   # or: forkable-mcp --auth --file ./forkable.curl",
        );
        process.exit(1);
      }
      const { me } = await ingestCredentials({ curl: blob });
      console.error(`✓ Stored session for ${me.fullName || me.email || `user ${me.id}`}.`);
    }
    const s = await readSession();
    console.error(JSON.stringify(redact(s), null, 2));
  } catch (e) {
    if (e instanceof ReauthRequiredError) console.error(`Auth failed: ${e.message}`);
    else console.error(`Auth failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
