import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const STATIC_BLOCK_PATTERN = /\bstatic\s*\{/;
const targetDirectories =
  process.argv.length > 2 ? process.argv.slice(2) : ["out"];

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);
const browserTargets = Array.isArray(packageJson.browserslist)
  ? packageJson.browserslist
  : [];

if (
  !browserTargets.some((target) => /^ios_saf\s+>=\s+15(?:\.0)?$/i.test(target))
) {
  throw new Error(
    "package.json must keep an explicit ios_saf >= 15 target for iPadOS 16.1 compatibility."
  );
}

async function findJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findJavaScriptFiles(entryPath)));
    } else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

async function findFilesWithExtension(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findFilesWithExtension(entryPath, extension)));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(entryPath);
    }
  }

  return files;
}

async function assertLocalScriptsExist(directory) {
  const htmlFiles = await findFilesWithExtension(directory, ".html");
  const missingScripts = [];
  let referencedScriptCount = 0;

  for (const htmlFile of htmlFiles) {
    const html = await readFile(htmlFile, "utf8");
    const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;

    for (const match of html.matchAll(scriptPattern)) {
      const source = match[1].split(/[?#]/, 1)[0];

      if (/^(?:[a-z]+:)?\/\//i.test(source) || source.startsWith("data:")) {
        continue;
      }

      referencedScriptCount += 1;
      const scriptPath = source.startsWith("/")
        ? path.join(directory, source.slice(1))
        : path.resolve(path.dirname(htmlFile), source);

      try {
        await access(scriptPath);
      } catch {
        missingScripts.push(`${htmlFile} -> ${source}`);
      }
    }
  }

  if (htmlFiles.length === 0 || referencedScriptCount === 0) {
    throw new Error(`No HTML script references were found under ${directory}.`);
  }

  if (missingScripts.length > 0) {
    throw new Error(
      [
        `HTML files under ${directory} reference missing local scripts:`,
        ...missingScripts.map((entry) => `- ${entry}`)
      ].join("\n")
    );
  }

  return { htmlFileCount: htmlFiles.length, referencedScriptCount };
}

const incompatibleFiles = [];
let scannedFileCount = 0;
let scannedHtmlFileCount = 0;
let referencedScriptCount = 0;

for (const directory of targetDirectories) {
  const javascriptFiles = await findJavaScriptFiles(directory);
  const htmlResult = await assertLocalScriptsExist(directory);
  scannedFileCount += javascriptFiles.length;
  scannedHtmlFileCount += htmlResult.htmlFileCount;
  referencedScriptCount += htmlResult.referencedScriptCount;

  for (const file of javascriptFiles) {
    const source = await readFile(file, "utf8");

    if (STATIC_BLOCK_PATTERN.test(source)) {
      incompatibleFiles.push(file);
    }
  }
}

if (scannedFileCount === 0) {
  throw new Error(
    `No JavaScript build assets were found under: ${targetDirectories.join(", ")}`
  );
}

if (incompatibleFiles.length > 0) {
  throw new Error(
    [
      "Found class static initialization blocks that Safari/iPadOS before 16.4 cannot parse:",
      ...incompatibleFiles.map((file) => `- ${file}`)
    ].join("\n")
  );
}

console.log(
  `Web compatibility check passed (${scannedFileCount} JavaScript files, ${referencedScriptCount} script references in ${scannedHtmlFileCount} HTML files across ${targetDirectories.join(", ")}).`
);
