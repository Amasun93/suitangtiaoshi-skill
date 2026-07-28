import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(testDir, "..", "scripts", "organize-materials.mjs");

async function write(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

test("plans, safely copies, preserves code trees, and deduplicates", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "suitangtiaoshi-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const intake = path.join(root, "intake");
  const archiveRoot = path.join(root, "archives");
  const rosterPath = path.join(root, "roster.json");
  const planPath = path.join(root, "plan.json");
  const secondPlanPath = path.join(root, "plan-2.json");
  const auditPath = path.join(root, "audit.json");

  await fs.mkdir(archiveRoot, { recursive: true });
  await write(rosterPath, JSON.stringify({ students: [
    { number: 1, name: "张三", project: "智能书架", project_short: "智能书架" },
    { number: 2, name: "李四", project: "训练手套", project_short: "训练手套" },
  ] }));
  await write(path.join(intake, "张三", "开题", "最终开题.png"), "topic-image");
  await write(path.join(intake, "张三", "项目代码", "src", "main.py"), "print('ok')\n");
  await write(path.join(intake, "张三", "项目代码", "assets", "beep.mp3"), "audio-data");
  await write(path.join(intake, "李四", "制作过程", "制作过程01.jpg"), "process-image");
  await write(path.join(intake, "李四", "训练手套演示.mp4"), "video-data");
  await write(path.join(intake, "未知", "notes.txt"), "unknown-student");

  await execFileAsync(process.execPath, [script, "plan", "--intake", intake, "--archive-root", archiveRoot, "--roster", rosterPath, "--origin", "student", "--output", planPath]);
  const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
  assert.equal(plan.summary.total, 6);
  assert.equal(plan.summary.ready, 5);
  assert.equal(plan.summary.needs_review, 1);
  const codeTargets = plan.entries.filter((entry) => entry.category === "code").map((entry) => entry.target_relative);
  assert.ok(codeTargets.some((target) => target.endsWith("04 项目代码/src/main.py")));
  assert.ok(codeTargets.some((target) => target.endsWith("04 项目代码/assets/beep.mp3")));

  await assert.rejects(
    execFileAsync(process.execPath, [script, "apply", "--plan", planPath]),
    /--confirm/,
  );

  const applyResult = await execFileAsync(process.execPath, [script, "apply", "--plan", planPath, "--confirm", "--output", path.join(root, "apply.json")]);
  assert.match(applyResult.stdout, /"copied": 5/);
  assert.equal(await fs.readFile(path.join(archiveRoot, "随堂调试-张三-智能书架", "04 项目代码", "src", "main.py"), "utf8"), "print('ok')\n");
  assert.equal(await fs.readFile(path.join(archiveRoot, "随堂调试-张三-智能书架", "04 项目代码", "assets", "beep.mp3"), "utf8"), "audio-data");
  await assert.rejects(fs.access(path.join(archiveRoot, "随堂调试-未知-项目名称待补充")));

  await execFileAsync(process.execPath, [script, "plan", "--intake", intake, "--archive-root", archiveRoot, "--roster", rosterPath, "--origin", "student", "--output", secondPlanPath]);
  const secondPlan = JSON.parse(await fs.readFile(secondPlanPath, "utf8"));
  assert.equal(secondPlan.summary.duplicate, 5);
  assert.equal(secondPlan.summary.needs_review, 1);

  await execFileAsync(process.execPath, [script, "audit", "--archive-root", archiveRoot, "--roster", rosterPath, "--output", auditPath]);
  const audit = JSON.parse(await fs.readFile(auditPath, "utf8"));
  assert.equal(audit.reports.length, 2);
  assert.equal(audit.reports.find((item) => item.student === "张三").counts.code, 2);
});
