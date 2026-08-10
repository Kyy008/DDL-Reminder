import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [sourceDirectory, destinationDirectory] = process.argv.slice(2);

if (!sourceDirectory || !destinationDirectory) {
  throw new Error(
    "Usage: node scripts/check-synced-web-assets.mjs <source> <destination>"
  );
}

async function findFiles(directory, relativeDirectory = "") {
  const absoluteDirectory = path.join(directory, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findFiles(directory, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

const sourceFiles = await findFiles(sourceDirectory);
const mismatches = [];

for (const relativePath of sourceFiles) {
  try {
    const [source, destination] = await Promise.all([
      readFile(path.join(sourceDirectory, relativePath)),
      readFile(path.join(destinationDirectory, relativePath))
    ]);

    if (!source.equals(destination)) {
      mismatches.push(`${relativePath} (content differs)`);
    }
  } catch {
    mismatches.push(`${relativePath} (missing from destination)`);
  }
}

if (sourceFiles.length === 0) {
  throw new Error(`No files were found under ${sourceDirectory}.`);
}

if (mismatches.length > 0) {
  throw new Error(
    [
      `${destinationDirectory} is not synchronized with ${sourceDirectory}:`,
      ...mismatches.map((entry) => `- ${entry}`)
    ].join("\n")
  );
}

console.log(
  `Native Web assets are synchronized (${sourceFiles.length} files from ${sourceDirectory} to ${destinationDirectory}).`
);
