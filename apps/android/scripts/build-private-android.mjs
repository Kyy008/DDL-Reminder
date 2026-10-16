// Local-only helper. No credential is written to source or printed to stdout.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.CI) throw new Error("Private APKs cannot be built in CI.");
if (
  process.argv.includes("--release") &&
  [
    "ANDROID_KEYSTORE_PATH",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD"
  ].some((name) => !process.env[name]?.trim())
) {
  throw new Error(
    "Private release builds require the existing Android signing credentials."
  );
}
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
let apiKey = process.env.DEEPSEEK_API_KEY?.trim();
if (process.argv.includes("--from-zshrc")) {
  const source = readFileSync(resolve(homedir(), ".zshrc"), "utf8");
  const assignments = source.split(/\r?\n/).flatMap((line) => {
    const match = line.match(
      /^\s*(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(["']?)([A-Za-z0-9_-]{8,512})\1\s*(?:#.*)?$/
    );
    return match ? [match[2]] : [];
  });
  // Never execute shell startup scripts or evaluate command substitutions.
  if (new Set(assignments).size !== 1)
    throw new Error(
      "Could not resolve one unambiguous DEEPSEEK_API_KEY assignment. Set the environment variable instead."
    );
  apiKey = assignments[0];
}
if (!apiKey || !/^[A-Za-z0-9_-]{8,512}$/.test(apiKey))
  throw new Error(
    "Set DEEPSEEK_API_KEY, or use --from-zshrc for a literal export assignment."
  );
const env = {
  ...process.env,
  DDL_PRIVATE_ASSISTANT_BUILD: "true",
  DDL_DEEPSEEK_PRESET_KEY: apiKey
};
function run(command, args, cwd = appDirectory) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("npm", ["run", "build"]);
run("npx", ["cap", "sync", "android"]);
run(
  "./gradlew",
  [
    "--no-daemon",
    process.argv.includes("--release") ? "assembleRelease" : "assembleDebug"
  ],
  resolve(appDirectory, "android")
);
console.log(
  "Private APK built locally. Do not upload or publish it: its preset key can be extracted."
);
