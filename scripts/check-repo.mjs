#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_FILES = [
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".github/ISSUE_TEMPLATE/bug.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/feature.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/ci.yml",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "docs/baseline/01-requirements-v2.1.md",
  "docs/baseline/02-design-v1.0.md",
  "docs/baseline/README.md",
  "docs/levels.md",
  "docs/project-brief.md",
  "docs/roadmap.md",
  "docs/storage-rank.md",
  "package.json",
  "scripts/check-repo.mjs",
  "scripts/mock-rank-server.mjs",
  "scripts/serve.mjs",
  "src/app/.gitkeep",
  "src/app/levels-loader.js",
  "src/app/rank.js",
  "src/app/save-schema.js",
  "src/app/store.js",
  "src/lib/board.js",
  "src/lib/clock.js",
  "src/lib/economy.js",
  "src/lib/levels.js",
  "src/lib/levels.json",
  "src/lib/logger.js",
  "src/lib/platform.js",
  "src/lib/random.js",
  "src/lib/run.js",
  "src/lib/score.js",
  "src/ui/.gitkeep",
  "test/board.test.mjs",
  "test/domain-boundaries.test.mjs",
  "test/economy.test.mjs",
  "test/levels.test.mjs",
  "test/platform.test.mjs",
  "test/rank.test.mjs",
  "test/repo.test.mjs",
  "test/save.test.mjs",
  "test/store.test.mjs",
  "test/run.test.mjs",
  "test/score.test.mjs",
  "test/server.test.mjs",
  "web/app.js",
  "web/index.html",
  "web/style.css",
];

const BASELINE_MARKERS = [
  {
    file: "docs/baseline/01-requirements-v2.1.md",
    markers: ["FR-01", "FR-32", "NFR-14", "FM-14", "BR-10", "TC-42", "C-10"],
  },
  {
    file: "docs/baseline/02-design-v1.0.md",
    markers: ["M12", "I-35", "DS-4", "FL-07", "UI-7", "D-12", "K-03", "2,140,200"],
  },
  {
    file: "docs/baseline/README.md",
    markers: ["K-03", "2,140,200", "2,150,000"],
  },
];

// 旧原型与内部过程文件不得进入最终仓库。
const FORBIDDEN_DIRS = ["game-impl"];
const FORBIDDEN_NAME_PARTS = ["内部记录", "AI协作记录", "人工核实说明"];

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export function checkRepo(root = ROOT) {
  const errors = [];
  const warnings = [];

  for (const rel of REQUIRED_FILES) {
    const full = join(root, rel);
    if (!existsSync(full)) {
      errors.push(`缺少文件：${rel}`);
      continue;
    }
    if (statSync(full).isFile() && statSync(full).size === 0) {
      errors.push(`文件为空：${rel}`);
    }
  }

  for (const { file, markers } of BASELINE_MARKERS) {
    const full = join(root, file);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, "utf8");
    for (const marker of markers) {
      if (!text.includes(marker)) errors.push(`${file} 缺少基线标记：${marker}`);
    }
  }

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      for (const script of ["check", "test", "dev"]) {
        if (!pkg.scripts?.[script]) errors.push(`package.json 缺少 script：${script}`);
      }
    } catch (error) {
      errors.push(`package.json 不是合法 JSON：${error.message}`);
    }
  }

  for (const dir of FORBIDDEN_DIRS) {
    if (existsSync(join(root, dir))) errors.push(`不应提交的目录存在：${dir}/`);
  }

  for (const full of walk(join(root, "docs"))) {
    const hit = FORBIDDEN_NAME_PARTS.find((part) => basename(full).includes(part));
    if (hit) errors.push(`docs/ 下不应出现内部文件：${relative(root, full)}`);
  }

  const ciPath = join(root, ".github/workflows/ci.yml");
  if (existsSync(ciPath)) {
    const ci = readFileSync(ciPath, "utf8");
    for (const command of ["npm run check", "npm test"]) {
      if (!ci.includes(command)) errors.push(`CI 工作流缺少命令：${command}`);
    }
  }

  return { errors, warnings };
}

function main() {
  const { errors, warnings } = checkRepo();
  for (const warning of warnings) console.warn(`警告：${warning}`);
  if (errors.length > 0) {
    console.error(`仓库校验失败（${errors.length} 项）：`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `仓库校验通过：${REQUIRED_FILES.length} 个必需文件、${BASELINE_MARKERS.length} 组基线标记。`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
