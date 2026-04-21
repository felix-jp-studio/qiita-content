const fs = require("fs");
const path = require("path");
const https = require("https");

const QIITA_USER = process.env.QIITA_USER || "felix-jp-studio";
const PER_PAGE = 100;
const DRY_RUN = process.argv.includes("--dry-run");

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if ((res.statusCode || 0) >= 400) {
            reject(
              new Error(
                `Qiita API error: status=${res.statusCode} body=${data.slice(0, 300)}`,
              ),
            );
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse API response: ${error.message}`));
          }
        });
      })
      .on("error", (error) => reject(error));
  });
}

async function fetchAllUserItems(userName) {
  const items = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = `https://qiita.com/api/v2/users/${encodeURIComponent(userName)}/items?page=${page}&per_page=${PER_PAGE}`;
    const pageItems = await requestJson(url);
    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break;
    }
    items.push(...pageItems);
    if (pageItems.length < PER_PAGE) {
      break;
    }
  }
  return items;
}

function normalizeTitle(rawTitle) {
  if (!rawTitle) return "";
  return rawTitle
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .normalize("NFKC");
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/);
  if (!match) return null;
  return { raw: match[0], body: match[1], endIndex: match[0].length };
}

function getField(frontmatterBody, key) {
  const match = frontmatterBody.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

function updateIdField(frontmatterBody, newId) {
  if (/^id:\s*.*$/m.test(frontmatterBody)) {
    return frontmatterBody.replace(/^id:\s*.*$/m, `id: ${newId}`);
  }
  return `${frontmatterBody}\nid: ${newId}`;
}

function syncLocalFilesByTitle(apiItems) {
  const apiMapByTitle = new Map();
  for (const item of apiItems) {
    const normalized = normalizeTitle(item.title);
    if (!apiMapByTitle.has(normalized)) {
      apiMapByTitle.set(normalized, []);
    }
    apiMapByTitle.get(normalized).push(item);
  }

  const publicDir = path.join(process.cwd(), "public");
  const files = fs
    .readdirSync(publicDir)
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  const result = {
    scanned: 0,
    updated: [],
    unmatched: [],
    ambiguous: [],
    skipped: [],
  };

  for (const fileName of files) {
    const fullPath = path.join(publicDir, fileName);
    result.scanned += 1;

    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch (error) {
      result.skipped.push({ fileName, reason: `read_error:${error.message}` });
      continue;
    }

    const parsed = parseFrontmatter(content);
    if (!parsed) {
      result.skipped.push({ fileName, reason: "missing_frontmatter" });
      continue;
    }

    const title = getField(parsed.body, "title");
    const idValue = getField(parsed.body, "id");
    const ignorePublish = (
      getField(parsed.body, "ignorePublish") || "false"
    ).toLowerCase();

    if (!title) {
      result.skipped.push({ fileName, reason: "missing_title" });
      continue;
    }
    if (ignorePublish === "true") {
      result.skipped.push({ fileName, reason: "ignorePublish_true" });
      continue;
    }
    if (idValue && idValue !== "null") {
      result.skipped.push({ fileName, reason: "id_already_set" });
      continue;
    }

    const key = normalizeTitle(title);
    const candidates = apiMapByTitle.get(key) || [];

    if (candidates.length === 0) {
      result.unmatched.push({ fileName, title });
      continue;
    }
    if (candidates.length > 1) {
      result.ambiguous.push({
        fileName,
        title,
        candidateIds: candidates.map((x) => x.id),
      });
      continue;
    }

    const targetId = candidates[0].id;
    const updatedFrontmatter = updateIdField(parsed.body, targetId);
    const newContent = `---\n${updatedFrontmatter}\n---\n${content.slice(parsed.endIndex)}`;

    if (!DRY_RUN) {
      fs.writeFileSync(fullPath, newContent, "utf8");
    }

    result.updated.push({
      fileName,
      title,
      id: targetId,
    });
  }

  return result;
}

function printReport(result) {
  console.log(`Mode: ${DRY_RUN ? "dry-run" : "write"}`);
  console.log(`Scanned files: ${result.scanned}`);
  console.log(`Updated IDs: ${result.updated.length}`);
  console.log(`Unmatched titles: ${result.unmatched.length}`);
  console.log(`Ambiguous titles: ${result.ambiguous.length}`);
  console.log(`Skipped files: ${result.skipped.length}`);

  if (result.updated.length > 0) {
    console.log("\n[Updated]");
    for (const item of result.updated) {
      console.log(`- ${item.fileName} -> ${item.id}`);
    }
  }

  if (result.unmatched.length > 0) {
    console.log("\n[Unmatched]");
    for (const item of result.unmatched) {
      console.log(`- ${item.fileName}: ${item.title}`);
    }
  }

  if (result.ambiguous.length > 0) {
    console.log("\n[Ambiguous]");
    for (const item of result.ambiguous) {
      console.log(
        `- ${item.fileName}: ${item.title} (candidates: ${item.candidateIds.join(", ")})`,
      );
    }
  }
}

async function main() {
  try {
    console.log(`Fetching Qiita items for @${QIITA_USER}...`);
    const apiItems = await fetchAllUserItems(QIITA_USER);
    console.log(`Fetched items: ${apiItems.length}`);

    const result = syncLocalFilesByTitle(apiItems);
    printReport(result);

    if (result.updated.length === 0) {
      console.log("\nNo files were updated.");
    }
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

main();
