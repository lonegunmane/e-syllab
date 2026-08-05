const fs = require("fs");

function fixDirnameBug(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`  (skip - not found: ${filePath})`);
    return;
  }
  let content = fs.readFileSync(filePath, "utf8");
  const before = content;

  content = content.replace(
    /const __filename\s*=\s*fileURLToPath\(import\.meta\.url\);\r?\n\s*const __dirname\s*=\s*path\.dirname\(__filename\);\r?\n?/g,
    ""
  );

  content = content.replace(/\b__dirname\b/g, "process.cwd()");

  if (content !== before) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  FIXED: ${filePath}`);
  } else {
    console.log(`  clean already: ${filePath}`);
  }
}

function ensureGitignoreHasData() {
  const gitignorePath = ".gitignore";
  let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const lines = content.split(/\r?\n/).map(l => l.trim());
  if (!lines.includes("data/")) {
    content = content.trim() + "\ndata/\n";
    fs.writeFileSync(gitignorePath, content, "utf8");
    console.log("  FIXED: re-added data/ to .gitignore");
  } else {
    console.log("  clean already: .gitignore has data/");
  }
}

console.log("Checking server.ts and services/serverDatabase.ts for the __dirname bug...");
fixDirnameBug("server.ts");
fixDirnameBug("services/serverDatabase.ts");

console.log("\nChecking .gitignore for data/...");
ensureGitignoreHasData();

console.log("\nDone. Now review with git status before committing, as usual.");
