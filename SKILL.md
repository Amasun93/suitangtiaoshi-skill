---
name: suitangtiaoshi-skill
description: Batch-organize teachers' classroom project materials into per-student suitangtiaoshi delivery archives. Use when a teacher needs to inspect an intake folder, match files to students and projects, classify and rename documents, drawings, code, images, presentations, videos, handover forms, papers, or research logs, generate a dry-run review plan, safely copy approved materials into the standard archive structure, deduplicate by SHA-256, or audit unresolved items. Designed for teacher-side bulk filing; never delete source materials or guess ambiguous student ownership.
---

# 随堂调试：教师批量整理

本 Skill 先提供“整理归档”核心能力。它把老师收到的散乱素材整理进每名学生的正式母档案，同时保留人工审核环节。

## 固定原则

- 先预演、后执行。第一次运行只能生成整理计划，不直接归档。
- 只复制，不移动、不删除源文件。
- 不覆盖已有文件；同名不同内容自动建立 `-v2`、`-v3` 版本。
- 使用 SHA-256 识别重复内容；相同文件不重复复制。
- 学生归属不明确时不写入任何学生档案。
- 类别不明确时标记 `needs_review`，由老师确认后才能执行。
- 图片、视频、签字、项目事实和材料质量始终需要人工核验。
- 代码项目保留原有内部目录和文件名，避免破坏依赖关系。

## 标准目录

每名学生使用 `随堂调试-{学生姓名}-{项目名称}`，目录结构以 [archive-schema.json](references/archive-schema.json) 为准。正式材料进入 `01—09`，课堂研究日志进入 `10 研究日志`，尚未确认的材料使用 `99 待确认`。

## 整理流程

### 1. 确认输入

需要三个位置：

1. 老师收到的素材目录。
2. 正式档案根目录，例如 `项目交付档案`。
3. 学生与项目清单 JSON。

清单可沿用现有班级数据，也可参考 [roster.example.json](references/roster.example.json)。至少要有学生姓名和项目名称；小名、旧题目或文件夹简称放入 `aliases` 和 `project_aliases`。

### 2. 生成预演计划

```bash
node scripts/organize-materials.mjs plan \
  --intake "待整理素材目录" \
  --archive-root "项目交付档案" \
  --roster "学生项目清单.json" \
  --origin teacher \
  --output "整理预演.json"
```

`--origin` 可用 `teacher`、`student`、`ai` 或 `unknown`。混合来源时先用 `unknown`，再在计划中逐项修正。

脚本同时生成 JSON 和同名 Markdown 摘要。向老师报告：总文件数、可归档数、待确认数、重复数，以及每个学生的材料分布。不要只说“整理好了”。

### 3. 审核计划

重点检查 `needs_review`：

- 学生匹配是否唯一。
- 视频是老师讲解版还是学生正式版。
- 图片属于功能、实验、原型还是制作过程。
- HTML 是学生项目手册还是代码页面。
- 压缩包、音频、无说明文档应进入哪里。

可使用覆盖文件修正规则，不需要改脚本：

```json
{
  "files": {
    "张三/IMG_001.jpg": {
      "student": "张三",
      "category": "key_images",
      "subitem": "process_images",
      "origin": "student",
      "status": "approved"
    }
  }
}
```

重新运行 `plan` 时增加 `--overrides "人工修正.json"`。若只修改已生成计划，也可把条目的 `status` 改为 `approved`，但目标路径仍需符合标准目录。

### 4. 获得确认后执行

向老师展示简短变更摘要并明确等待确认。确认后运行：

```bash
node scripts/organize-materials.mjs apply --plan "整理预演.json" --confirm
```

执行只处理 `ready` 和 `approved` 项；`needs_review` 保持原位。每个学生档案写入 `整理归档记录.jsonl`，计划旁生成执行结果 JSON。

### 5. 核验结果

```bash
node scripts/organize-materials.mjs audit \
  --archive-root "项目交付档案" \
  --roster "学生项目清单.json" \
  --output "档案检查.json"
```

报告每名学生各目录文件数、缺少的必交项、`99 待确认` 数量和重复哈希。材料“存在”不等于“验收通过”，不要自动给出最终验收结论。

## 判断优先级

1. 人工覆盖规则。
2. 路径中的学生姓名、小名、项目名。
3. 文件夹和文件名中的材料关键词。
4. 扩展名。
5. 无法可靠判断则待确认。

详细分类、命名标签和扩展名规则见 [archive-schema.json](references/archive-schema.json)。

## 当前边界

本版本负责批量整理、复制、去重、命名、记录和缺项检查。它暂不负责材料内容质量验收、照片人脸处理、视频清晰度分析、学生项目事实审核、课堂看板同步或最终交付压缩包生成。
