// Post-build guard: the browser bundle must never contain keys, service-role references, or grader secrets.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const banned = [
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["service role reference", /service_role|SERVICE_ROLE/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{16,}/],
  ["grader notes", /Strong prompt:/],
  ["grader prompt", /You are the grader for a student/],
];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const findings = [];
for (const file of walk("dist")) {
  const text = readFileSync(file, "utf8");
  for (const [name, rx] of banned) if (rx.test(text)) findings.push(`${file}: ${name}`);
}
if (findings.length) {
  console.error("dist check failed:\n" + findings.join("\n"));
  process.exit(1);
}
console.log("dist check passed: no keys, service-role references, or grader secrets in the bundle.");
