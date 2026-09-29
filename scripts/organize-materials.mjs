#!/usr/bin/env node
import fs from "node:fs/promises";
import { constants as fsConstants, createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSchemaPath = path.resolve(scriptDir, "..", "references", "archive-schema.json");
const validOrigins = new Set(["teacher", "student", "ai", "unknown"]);
const actionableStatuses = new Set(["ready", "approved"]);
const ignoredNames = new Set([".git", "node_modules", "Thumbs.db", ".DS_Store"]);

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const args = { command };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function fail(message) {
  throw new Error(message);
}

function slash(value) {
  return String(value).replaceAll("\\", "/");
}

function cleanSegment(value, fallback = "未命名") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned || fallback;
}

function cleanRelative(value) {
  return slash(value)
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => cleanSegment(segment))
    .join("/");
}

function normalized(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-—–·・()（）【】\[\]《》<>]/g, "");
}

function pathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function timestampForFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoredNames.has(entry.name) || entry.name.startsWith(".~")) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(absolute);
    }
  }
  await visit(root);
  return output.sort((left, right) => slash(left).localeCompare(slash(right), "zh-CN", { numeric: true }));
}

async function countFiles(root) {
  if (!(await exists(root))) return 0;
  return (await listFiles(root)).length;
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

function projectTitle(raw) {
  if (typeof raw.project === "string") return raw.project;
  return raw.project?.title || raw.project_title || raw.title || "项目名称待补充";
}

function normalizeRoster(payload) {
  const rows = Array.isArray(payload) ? payload : payload.students;
  if (!Array.isArray(rows) || rows.length === 0) fail("学生清单中没有 students 数据。");
  const students = rows.map((raw, index) => {
    const name = cleanSegment(raw.name, "");
    if (!name) fail(`学生清单第 ${index + 1} 项缺少姓名。`);
    const project = cleanSegment(projectTitle(raw));
    const projectShort = cleanSegment(raw.project_short || raw.project?.short || project);
    return {
      number: raw.number ?? index + 1,
      name,
      grade: raw.grade || "",
      project,
      project_short: projectShort,
      aliases: [...new Set([name, ...(raw.aliases || [])].filter(Boolean).map(String))],
      project_aliases: [...new Set([project, projectShort, ...(raw.project_aliases || [])].filter(Boolean).map(String))],
    };
  });
  const duplicateNames = students.map((item) => item.name).filter((name, index, all) => all.indexOf(name) !== index);
  if (duplicateNames.length) fail(`学生清单存在重名：${[...new Set(duplicateNames)].join("、")}。请增加唯一别名后拆分处理。`);
  return students;
}

function findStudentByName(students, name) {
  const target = normalized(name);
  return students.find((student) => normalized(student.name) === target || student.aliases.some((alias) => normalized(alias) === target));
}

function matchStudent(relativePath, students, forcedName) {
  if (forcedName) {
    const forced = findStudentByName(students, forcedName);
    return forced ? { student: forced, confidence: "manual", reason: "人工覆盖指定学生" } : { student: null, confidence: "none", reason: `人工覆盖中的学生不存在：${forcedName}` };
  }
  const haystack = normalized(relativePath);
  const candidates = [];
  for (const student of students) {
    const tokens = [...student.aliases, ...student.project_aliases]
      .map((token) => ({ raw: token, value: normalized(token) }))
      .filter((token) => token.value.length >= 2 && haystack.includes(token.value));
    if (!tokens.length) continue;
    const best = tokens.sort((left, right) => right.value.length - left.value.length)[0];
    candidates.push({ student, token: best.raw, score: best.value.length, isName: student.aliases.includes(best.raw) });
  }
  if (!candidates.length) return { student: null, confidence: "none", reason: "路径中未识别到学生姓名、别名或项目名" };
  candidates.sort((left, right) => Number(right.isName) - Number(left.isName) || right.score - left.score);
  const best = candidates[0];
  const tied = candidates.filter((candidate) => candidate.isName === best.isName && candidate.score === best.score);
  if (new Set(tied.map((candidate) => candidate.student.name)).size > 1) {
    return { student: null, confidence: "none", reason: `路径同时匹配多个学生：${tied.map((item) => item.student.name).join("、")}` };
  }
  return { student: best.student, confidence: best.isName ? "high" : "medium", reason: `路径匹配“${best.token}”` };
}

function includesKeyword(value, keywords = []) {
  const haystack = normalized(value);
  return keywords.some((keyword) => haystack.includes(normalized(keyword)));
}

function categoryMap(schema) {
  return new Map(schema.folders.map((item) => [item.key, item]));
}

function classifyMaterial(relativePath, schema, forcedCategory, forcedSubitem) {
  const extension = path.extname(relativePath).toLowerCase();
  const keywords = schema.keywords || {};
  const extensions = schema.extensions || {};
  const fileName = path.basename(relativePath);
  const parentText = slash(path.dirname(relativePath));
  const fullText = slash(relativePath);

  if (forcedCategory) {
    return { key: forcedCategory, subitem: forcedSubitem || null, confidence: "manual", reason: "人工覆盖指定材料类别" };
  }

  const orderedKeywordCategories = [
    "handover_form",
    "defense_ppt",
    "project_manual",
    "topic_book",
    "research_log",
    "demo_video",
    "student_paper",
  ];
  for (const key of orderedKeywordCategories) {
    if (includesKeyword(fullText, keywords[key])) return { key, subitem: null, confidence: "high", reason: `路径包含“${keywords[key].find((word) => includesKeyword(fullText, [word]))}”` };
  }

  if (includesKeyword(parentText, keywords.code)) return { key: "code", subitem: null, confidence: "high", reason: "位于代码或程序目录" };
  if (includesKeyword(parentText, keywords.drawings)) return { key: "drawings", subitem: null, confidence: "high", reason: "位于图纸或模型目录" };
  if ((extensions.videos || []).includes(extension)) return { key: "demo_video", subitem: null, confidence: "medium", reason: `视频扩展名 ${extension}` };
  if ((extensions.drawings || []).includes(extension)) return { key: "drawings", subitem: null, confidence: "high", reason: `图纸/模型扩展名 ${extension}` };
  if ((extensions.code || []).includes(extension)) return { key: "code", subitem: null, confidence: "medium", reason: `代码扩展名 ${extension}` };
  if ((extensions.presentations || []).includes(extension)) return { key: "pending", subitem: null, confidence: "low", reason: "演示文稿未说明是开题还是答辩" };
  if ((extensions.images || []).includes(extension)) {
    const subitemOrder = ["function_images", "experiment_images", "prototype_images", "process_images"];
    for (const subitem of subitemOrder) {
      if (includesKeyword(fileName, keywords[subitem])) return { key: "key_images", subitem, confidence: "high", reason: `图片名称匹配${subitem}` };
    }
    return { key: "key_images", subitem: "reference_images", confidence: "medium", reason: "图片类型明确，具体用途待人工复核" };
  }
  return { key: "pending", subitem: null, confidence: "low", reason: `无法仅凭路径和扩展名 ${extension || "无扩展名"} 判断类别` };
}

function originLabel(origin) {
  return ({ teacher: "老师预开发版", student: "学生制作版", ai: "AI生成待核版", unknown: "版本待确认" })[origin] || "版本待确认";
}

function stripMatchedRoot(relativePath, student) {
  const parts = slash(relativePath).split("/");
  const tokens = [...student.aliases, ...student.project_aliases].map(normalized).filter(Boolean);
  const matchIndex = parts.findIndex((part) => tokens.some((token) => normalized(part).includes(token)));
  return matchIndex >= 0 && matchIndex < parts.length - 1 ? parts.slice(matchIndex + 1) : parts;
}

function preservedTree(relativePath, student, schema, category) {
  let parts = stripMatchedRoot(relativePath, student);
  const keywords = schema.keywords?.[category] || [];
  const keywordIndex = parts.findIndex((part) => includesKeyword(part, keywords));
  if (keywordIndex >= 0 && keywordIndex < parts.length - 1) parts = parts.slice(keywordIndex + 1);
  return cleanRelative(parts.join("/")) || cleanSegment(path.basename(relativePath));
}

async function nextSequence(targetDirectory, counterKey, counters) {
  if (!counters.has(counterKey)) counters.set(counterKey, await countFiles(targetDirectory));
  const value = counters.get(counterKey) + 1;
  counters.set(counterKey, value);
  return String(value).padStart(2, "0");
}

async function suggestedTarget({ source, relative, student, archiveName, category, subitem, origin, schema, archiveRoot, counters, overrideName }) {
  const folders = categoryMap(schema);
  const folder = folders.get(category);
  if (!folder) fail(`归档标准不支持类别：${category}`);
  const extension = path.extname(source).toLowerCase();
  const originalStem = cleanSegment(path.basename(source, path.extname(source)));
  let targetDirectory = path.join(archiveRoot, archiveName, folder.folder);
  let targetName;
  if (category === "key_images") {
    const item = folder.subitems?.find((candidate) => candidate.key === subitem) || folder.subitems?.find((candidate) => candidate.key === "reference_images");
    targetDirectory = path.join(targetDirectory, item.folder);
    if (item.key === "reference_images") targetName = `${student.project_short}-${item.label}-${originalStem}${extension}`;
    else {
      const sequence = await nextSequence(targetDirectory, `${archiveName}/${folder.folder}/${item.folder}`, counters);
      targetName = `${student.project_short}-${item.label}-${sequence}${extension}`;
    }
  } else if (category === "code" || category === "research_log") {
    targetName = preservedTree(relative, student, schema, category);
  } else if (category === "topic_book") targetName = `${student.name}-开题书-${originLabel(origin)}${extension}`;
  else if (category === "project_manual") targetName = `${student.name}-学生项目手册-${originLabel(origin)}${extension}`;
  else if (category === "drawings") targetName = `${student.project_short}-项目图纸-${originalStem}${extension}`;
  else if (category === "defense_ppt") targetName = `${student.name}-${student.project_short}-${(schema.extensions?.videos || []).includes(extension) ? "答辩视频" : "答辩PPT"}-${originLabel(origin)}${extension}`;
  else if (category === "demo_video") targetName = `${student.project_short}-演示视频-${origin === "student" ? "学生正式版" : origin === "teacher" ? "老师讲解版" : originLabel(origin)}${extension}`;
  else if (category === "handover_form") targetName = `${student.name}-项目装置交接单-${origin === "student" ? "签字版" : originLabel(origin)}${extension}`;
  else if (category === "student_paper") targetName = `${student.name}-${student.project_short}-学生论文${extension}`;
  else targetName = `${student.name}-待确认-${originalStem}${extension}`;
  if (overrideName) targetName = cleanRelative(overrideName);
  return slash(path.join(archiveName, folder.folder, targetName));
}

async function archiveDirectoryName(archiveRoot, student, schema) {
  const prefix = `随堂调试-${student.name}-`;
  const entries = await fs.readdir(archiveRoot, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  const matches = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix)).map((entry) => entry.name);
  if (matches.length === 1) return { name: matches[0], ambiguous: false, reason: "匹配现有学生档案" };
  const expected = cleanSegment(schema.archive_name_template.replace("{student}", student.name).replace("{project}", student.project));
  if (matches.includes(expected)) return { name: expected, ambiguous: false, reason: "匹配标准档案名" };
  if (matches.length > 1) return { name: null, ambiguous: true, reason: `发现多个学生档案：${matches.join("、")}` };
  return { name: expected, ambiguous: false, reason: "将创建标准学生档案" };
}

async function getExistingFilesBySize(archivePath, cache) {
  if (cache.has(archivePath)) return cache.get(archivePath);
  const grouped = new Map();
  if (await exists(archivePath)) {
    for (const file of await listFiles(archivePath)) {
      const stat = await fs.stat(file);
      const values = grouped.get(stat.size) || [];
      values.push({ file, hash: null });
      grouped.set(stat.size, values);
    }
  }
  cache.set(archivePath, grouped);
  return grouped;
}

async function findDuplicate(archivePath, sourceHash, sourceSize, cache) {
  const grouped = await getExistingFilesBySize(archivePath, cache);
  for (const candidate of grouped.get(sourceSize) || []) {
    if (!candidate.hash) candidate.hash = await hashFile(candidate.file);
    if (candidate.hash === sourceHash) return candidate.file;
  }
  return null;
}

function loadOverrides(payload) {
  if (!payload) return {};
  return payload.files && typeof payload.files === "object" ? payload.files : payload;
}

function overrideFor(overrides, relative) {
  return overrides[slash(relative)] || overrides[slash(relative).toLowerCase()] || {};
}

function summarize(entries) {
  const statuses = entries.reduce((result, entry) => {
    result[entry.status] = (result[entry.status] || 0) + 1;
    return result;
  }, {});
  const students = {};
  for (const entry of entries) {
    const key = entry.student || "未匹配学生";
    students[key] ||= { total: 0, ready: 0, needs_review: 0, duplicate: 0 };
    students[key].total += 1;
    students[key][entry.status] = (students[key][entry.status] || 0) + 1;
  }
  return { total: entries.length, ready: statuses.ready || 0, approved: statuses.approved || 0, needs_review: statuses.needs_review || 0, duplicate: statuses.duplicate || 0, students };
}

function markdownEscape(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function planMarkdown(plan) {
  const rows = plan.entries.map((entry) => `| ${markdownEscape(entry.status)} | ${markdownEscape(entry.student || "未匹配")} | ${markdownEscape(entry.category_label)} | ${markdownEscape(entry.source_relative)} | ${markdownEscape(entry.target_relative || "-")} | ${markdownEscape(entry.reason)} |`).join("\n");
  return `# 随堂调试素材整理预演\n\n- 生成时间：${plan.created_at}\n- 素材目录：\`${plan.intake_root}\`\n- 档案目录：\`${plan.archive_root}\`\n- 文件总数：${plan.summary.total}\n- 可执行：${plan.summary.ready + plan.summary.approved}\n- 待确认：${plan.summary.needs_review}\n- 重复：${plan.summary.duplicate}\n\n| 状态 | 学生 | 类别 | 原文件 | 建议目标 | 判断依据 |\n|---|---|---|---|---|---|\n${rows}\n`;
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function createPlan(args) {
  if (!args.intake || !args["archive-root"] || !args.roster) fail("plan 需要 --intake、--archive-root 和 --roster。");
  const intakeRoot = path.resolve(args.intake);
  const archiveRoot = path.resolve(args["archive-root"]);
  const rosterPath = path.resolve(args.roster);
  if (!(await exists(intakeRoot))) fail("素材目录不存在。");
  const origin = args.origin || "unknown";
  if (!validOrigins.has(origin)) fail(`不支持的来源：${origin}`);
  const schema = await readJson(path.resolve(args.schema || defaultSchemaPath));
  const students = normalizeRoster(await readJson(rosterPath));
  const overrides = loadOverrides(args.overrides ? await readJson(path.resolve(args.overrides)) : null);
  const sourceFiles = await listFiles(intakeRoot);
  const counters = new Map();
  const existingCache = new Map();
  const entries = [];

  for (const source of sourceFiles) {
    const relative = slash(path.relative(intakeRoot, source));
    const override = overrideFor(overrides, relative);
    const studentMatch = matchStudent(relative, students, override.student);
    const classification = classifyMaterial(relative, schema, override.category, override.subitem);
    const currentOrigin = override.origin || origin;
    if (!validOrigins.has(currentOrigin)) fail(`${relative} 的 origin 不合法：${currentOrigin}`);
    const stat = await fs.stat(source);
    const sha256 = await hashFile(source);
    const folder = categoryMap(schema).get(classification.key) || categoryMap(schema).get("pending");
    let targetRelative = null;
    let duplicatePath = null;
    let archive = null;
    let status = override.status || "ready";
    const reasons = [studentMatch.reason, classification.reason];

    if (!studentMatch.student) status = "needs_review";
    else {
      archive = await archiveDirectoryName(archiveRoot, studentMatch.student, schema);
      reasons.push(archive.reason);
      if (archive.ambiguous) status = "needs_review";
      else {
        targetRelative = await suggestedTarget({
          source,
          relative,
          student: studentMatch.student,
          archiveName: archive.name,
          category: classification.key,
          subitem: classification.subitem,
          origin: currentOrigin,
          schema,
          archiveRoot,
          counters,
          overrideName: override.name,
        });
        duplicatePath = await findDuplicate(path.join(archiveRoot, archive.name), sha256, stat.size, existingCache);
      }
    }
    if (duplicatePath) status = "duplicate";
    else if (classification.key === "pending" || (classification.key === "demo_video" && currentOrigin === "unknown")) status = status === "approved" ? "approved" : "needs_review";
    if (!new Set(["ready", "approved", "needs_review", "duplicate"]).has(status)) status = "needs_review";

    entries.push({
      source_relative: relative,
      source_absolute: source,
      size: stat.size,
      sha256,
      student: studentMatch.student?.name || null,
      student_number: studentMatch.student?.number ?? null,
      project: studentMatch.student?.project || null,
      archive_name: archive?.name || null,
      category: classification.key,
      category_label: folder?.label || "待确认",
      subitem: classification.subitem,
      origin: currentOrigin,
      confidence: override.status ? "manual" : [studentMatch.confidence, classification.confidence].includes("low") ? "low" : classification.confidence,
      target_relative: duplicatePath ? slash(path.relative(archiveRoot, duplicatePath)) : targetRelative,
      status,
      reason: reasons.filter(Boolean).join("；"),
    });
  }

  const output = path.resolve(args.output || path.join(process.cwd(), `整理预演-${timestampForFile()}.json`));
  const plan = {
    schema_version: "suitangtiaoshi-plan-v1",
    created_at: new Date().toISOString(),
    intake_root: intakeRoot,
    archive_root: archiveRoot,
    roster_path: rosterPath,
    schema_path: path.resolve(args.schema || defaultSchemaPath),
    default_origin: origin,
    summary: summarize(entries),
    entries,
  };
  await writeJson(output, plan);
  await fs.writeFile(output.replace(/\.json$/i, ".md"), planMarkdown(plan), "utf8");
  process.stdout.write(`${JSON.stringify({ status: "planned", output, summary: plan.summary }, null, 2)}\n`);
}

async function ensureArchiveStructure(archivePath, schema) {
  await fs.mkdir(archivePath, { recursive: true });
  for (const folder of schema.folders) {
    await fs.mkdir(path.join(archivePath, folder.folder), { recursive: true });
    for (const subitem of folder.subitems || []) await fs.mkdir(path.join(archivePath, folder.folder, subitem.folder), { recursive: true });
  }
}

async function uniqueDestination(target, sourceHash) {
  if (!(await exists(target))) return { destination: target, duplicate: false };
  if ((await hashFile(target)) === sourceHash) return { destination: target, duplicate: true };
  const extension = path.extname(target);
  const base = target.slice(0, target.length - extension.length);
  for (let version = 2; version < 1000; version += 1) {
    const candidate = `${base}-v${version}${extension}`;
    if (!(await exists(candidate))) return { destination: candidate, duplicate: false };
    if ((await hashFile(candidate)) === sourceHash) return { destination: candidate, duplicate: true };
  }
  fail(`同名版本过多：${target}`);
}

async function appendArchiveLog(archivePath, record) {
  await fs.appendFile(path.join(archivePath, "整理归档记录.jsonl"), `${JSON.stringify({ ...record, recorded_at: new Date().toISOString() })}\n`, "utf8");
}

async function applyPlan(args) {
  if (!args.plan || !args.confirm) fail("apply 需要 --plan 和显式的 --confirm。先审核预演计划再执行。");
  const planPath = path.resolve(args.plan);
  const plan = await readJson(planPath);
  if (plan.schema_version !== "suitangtiaoshi-plan-v1") fail("不支持的整理计划版本。");
  const intakeRoot = path.resolve(plan.intake_root);
  const archiveRoot = path.resolve(plan.archive_root);
  const schema = await readJson(plan.schema_path || defaultSchemaPath);
  const existingCache = new Map();
  const results = [];

  for (const entry of plan.entries) {
    if (!actionableStatuses.has(entry.status)) {
      results.push({ source_relative: entry.source_relative, status: "skipped", reason: `计划状态为 ${entry.status}` });
      continue;
    }
    if (!entry.student || !entry.archive_name || !entry.target_relative) {
      results.push({ source_relative: entry.source_relative, status: "skipped", reason: "缺少学生或目标路径" });
      continue;
    }
    const source = path.resolve(entry.source_absolute || path.join(intakeRoot, entry.source_relative));
    if (!pathInside(intakeRoot, source) || !(await exists(source))) {
      results.push({ source_relative: entry.source_relative, status: "failed", reason: "源文件不存在或超出素材目录" });
      continue;
    }
    const currentHash = await hashFile(source);
    if (currentHash !== entry.sha256) {
      results.push({ source_relative: entry.source_relative, status: "failed", reason: "源文件在预演后发生变化" });
      continue;
    }
    const archivePath = path.join(archiveRoot, cleanSegment(entry.archive_name));
    const requestedTarget = path.join(archiveRoot, ...cleanRelative(entry.target_relative).split("/"));
    if (!pathInside(archiveRoot, archivePath) || !pathInside(archivePath, requestedTarget)) {
      results.push({ source_relative: entry.source_relative, status: "failed", reason: "目标路径越界" });
      continue;
    }
    await ensureArchiveStructure(archivePath, schema);
    const duplicate = await findDuplicate(archivePath, currentHash, entry.size, existingCache);
    if (duplicate) {
      results.push({ source_relative: entry.source_relative, status: "duplicate", destination: slash(path.relative(archiveRoot, duplicate)) });
      await appendArchiveLog(archivePath, { action: "duplicate", source: entry.source_relative, existing: slash(path.relative(archivePath, duplicate)), sha256: currentHash });
      continue;
    }
    await fs.mkdir(path.dirname(requestedTarget), { recursive: true });
    const unique = await uniqueDestination(requestedTarget, currentHash);
    if (unique.duplicate) {
      results.push({ source_relative: entry.source_relative, status: "duplicate", destination: slash(path.relative(archiveRoot, unique.destination)) });
      continue;
    }
    await fs.copyFile(source, unique.destination, fsConstants.COPYFILE_EXCL);
    const grouped = await getExistingFilesBySize(archivePath, existingCache);
    const values = grouped.get(entry.size) || [];
    values.push({ file: unique.destination, hash: currentHash });
    grouped.set(entry.size, values);
    const destinationRelative = slash(path.relative(archiveRoot, unique.destination));
    results.push({ source_relative: entry.source_relative, status: "copied", destination: destinationRelative, sha256: currentHash });
    await appendArchiveLog(archivePath, { action: "copy", source: entry.source_relative, destination: slash(path.relative(archivePath, unique.destination)), sha256: currentHash, origin: entry.origin, category: entry.category });
  }

  const output = path.resolve(args.output || path.join(path.dirname(planPath), `归档执行结果-${timestampForFile()}.json`));
  const payload = {
    schema_version: "suitangtiaoshi-apply-result-v1",
    plan: planPath,
    completed_at: new Date().toISOString(),
    summary: results.reduce((summary, item) => ({ ...summary, [item.status]: (summary[item.status] || 0) + 1 }), {}),
    results,
  };
  await writeJson(output, payload);
  process.stdout.write(`${JSON.stringify({ status: "applied", output, summary: payload.summary }, null, 2)}\n`);
}

async function duplicateGroups(root) {
  const files = (await exists(root) ? await listFiles(root) : []).filter((file) => !["整理归档记录.jsonl", "学生项目档案.json", "交付清单.json"].includes(path.basename(file)));
  const bySize = new Map();
  for (const file of files) {
    const size = (await fs.stat(file)).size;
    if (size === 0) continue;
    const values = bySize.get(size) || [];
    values.push(file);
    bySize.set(size, values);
  }
  const byHash = new Map();
  for (const candidates of [...bySize.values()].filter((items) => items.length > 1)) {
    for (const file of candidates) {
      const hash = await hashFile(file);
      const values = byHash.get(hash) || [];
      values.push(slash(path.relative(root, file)));
      byHash.set(hash, values);
    }
  }
  return [...byHash.entries()].filter(([, filesWithHash]) => filesWithHash.length > 1).map(([sha256, filesWithHash]) => ({ sha256, files: filesWithHash }));
}

async function auditArchives(args) {
  if (!args["archive-root"] || !args.roster) fail("audit 需要 --archive-root 和 --roster。");
  const archiveRoot = path.resolve(args["archive-root"]);
  const schema = await readJson(path.resolve(args.schema || defaultSchemaPath));
  const students = normalizeRoster(await readJson(path.resolve(args.roster)));
  const reports = [];
  for (const student of students) {
    const archive = await archiveDirectoryName(archiveRoot, student, schema);
    if (archive.ambiguous || !archive.name || !(await exists(path.join(archiveRoot, archive.name)))) {
      reports.push({ student: student.name, project: student.project, archive: archive.name, status: "missing_archive", reason: archive.reason });
      continue;
    }
    const archivePath = path.join(archiveRoot, archive.name);
    const counts = {};
    const missingRequired = [];
    for (const folder of schema.folders) {
      const count = await countFiles(path.join(archivePath, folder.folder));
      counts[folder.key] = count;
      if (folder.required && count < (folder.minimum_files ?? 1)) missingRequired.push(folder.label);
    }
    reports.push({
      student: student.name,
      project: student.project,
      archive: archive.name,
      status: "audited",
      counts,
      missing_required: missingRequired,
      pending_count: counts.pending || 0,
      duplicate_groups: await duplicateGroups(archivePath),
    });
  }
  const output = path.resolve(args.output || path.join(process.cwd(), `档案检查-${timestampForFile()}.json`));
  const payload = { schema_version: "suitangtiaoshi-audit-v1", created_at: new Date().toISOString(), archive_root: archiveRoot, reports };
  await writeJson(output, payload);
  process.stdout.write(`${JSON.stringify({ status: "audited", output, students: reports.length, missing_archives: reports.filter((item) => item.status === "missing_archive").length }, null, 2)}\n`);
}

const args = parseArgs(process.argv.slice(2));
try {
  if (args.command === "plan") await createPlan(args);
  else if (args.command === "apply") await applyPlan(args);
  else if (args.command === "audit") await auditArchives(args);
  else fail("用法：organize-materials.mjs <plan|apply|audit> [参数]");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
