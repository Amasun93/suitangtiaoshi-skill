---
name: suitangtiaoshi-skill
description: "Teacher-side classroom support for batch-organizing student project materials, preparing daily parent feedback, and handing confirmed student archives to the idealab-presentation module bundled inside ideaLab Student. Use when a teacher asks to organize materials, inspect archive or defense-evidence gaps, prepare a daily recap, polish student observations, or coordinate final-defense preparation. Never delete source materials, guess student identity, invent classroom facts, or duplicate the student-side presentation generator."
---

# 随堂调试：教师课堂工作流

本 Skill 面向教师，提供三项相互关联但独立执行的能力：

1. 整理学生项目素材并检查档案缺项。
2. 根据真实课堂情况生成每日家长回课。
3. 把确认过的学生档案交给 `idealab-student-skills` 的答辩模块。

## 路由

- 老师提出整理、归档、分类、去重、缺项检查时，执行“材料整理与归档”。
- 老师提出回课、家长反馈、学生表现润色、D1—D7模板或成长总结时，必须完整读取 [daily-parent-feedback.md](references/daily-parent-feedback.md)。需要生成当天公共内容时，再完整读取 [seven-day-feedback-templates.md](references/seven-day-feedback-templates.md)。
- 老师提出给学生做最终答辩、批量检查答辩素材、生成演示或逐页参考稿时，先完整读取 [idealab-presentation-routing.md](references/idealab-presentation-routing.md)。教师端只负责归档与缺项报告；实际生成由学生统一入口调用内置答辩模块。
- 同一请求同时包含素材整理和回课时，先核对素材事实，再生成回课；归档写入仍需单独确认。

## 共通原则

- 以老师确认的事实为最高优先级，不把计划、模板或AI建议写成已经完成。
- 从学生名单读取准确姓名；语音转写、文件名或旧消息与名单冲突时先确认。
- 保留“老师帮助”“AI辅助”“尚未完成”等责任与进度边界。
- 不上传学生名单、个人观察、照片、项目材料或密钥到 Skill 仓库。

## 材料整理与归档

### 固定原则

- 先预演、后执行。第一次运行只能生成整理计划，不直接归档。
- 每名学生只保留一套正式交付母档案；不要为“发同事”再长期复制一套相同文件。
- 归档核验前只复制，不移动、不删除来料。只有正式档案已存在、SHA-256一致且老师明确确认清理后，才能删除重复的过程副本。
- 不覆盖已有文件；同名不同内容自动建立 `-v2`、`-v3` 版本。
- 使用 SHA-256 识别重复内容；相同文件不重复复制。
- 学生归属不明确时不写入任何学生档案。
- 类别不明确时标记 `needs_review`，由老师确认后才能执行。
- 图片、视频、签字、项目事实和材料质量始终需要人工核验。
- 代码项目保留原有内部目录和文件名，避免破坏依赖关系。

### 标准目录

每名学生使用 `随堂调试-{学生姓名}-{项目名称}`，目录结构以 [archive-schema.json](references/archive-schema.json) 为准。正式材料进入 `01—09`，课堂研究日志进入 `10 研究日志`，尚未确认的材料使用 `99 待确认`。

- `06 答辩材料` 统一收纳学生答辩 PPT 和答辩视频；PPT 为可选材料，有则归档，没有不要求补做，也不计为缺项。
- `07 项目视频` 只收纳项目介绍、功能演示、老师讲解和学生正式演示，不收纳答辩视频。
- 功能实现图能够说明真实运行过程或结果时，可同时作为实验验证证据；实验图片不再作为独立硬性补件项。
- 项目原型图只展示装置本身的正视、俯视、侧视或整体结构，不要求学生出镜；孩子与装置合影归入制作过程关键图或其他参考资料。

### 唯一母档案与过程资料

- `01—09` 是可直接交给同事的正式材料。需要转发时直接使用这套母档案，不再建立长期并存的“转发包”。
- 正式交付包必须能脱离当前项目独立复制、压缩和打开；包内通用材料必须保存为真实文件，不得使用依赖项目内其他路径的硬链接、符号链接或快捷方式。允许同一通用材料在不同学生包中各保留一份，以换取单包完整性。
- `10 研究日志`、`99 待确认`、原始来料、教师底稿、调试输出和发送记录属于过程资料。默认保留在当前项目的独立工作区，便于继续跑通 Skill；不要未经用户要求搬到其他盘。
- 发送历史中的大文件若与正式档案哈希一致，可在确认后只删除重复载荷，保留发送信息、接收状态和清理审计记录。这会使历史下载链接失效，执行前必须明确告知老师。
- 如需压缩上传，压缩包是临时产物；发送成功并核对后可清理，不作为第二套母档案。

### 整理流程

#### 与老师沟通

- 老师直接提供文件或文件夹时，先自行定位其路径，不要求老师手写技术参数。
- 缺少素材目录、档案目录或学生清单时，只询问当前最关键的一项，并给出已找到的候选位置。
- 无法判断学生、材料类别或版本时必须询问老师，不得自行猜测。
- 同一批存在多个相同类型疑问时合并询问，例如一次确认“这 6 段视频都是老师讲解版吗？”，不要逐文件重复提问。
- 提问使用老师能直接选择的中文选项，如“老师讲解版 / 学生正式版 / 暂不确定”，不要要求老师编辑 JSON。
- 得到回答后由 AI 生成或更新覆盖规则，再重新生成预演计划。
- 只有老师明确说“确认归档”“可以执行”等同意语句后，才能运行 `apply --confirm`。

#### 1. 确认输入

需要三个位置：

1. 老师收到的素材目录。
2. 正式档案根目录，例如 `项目交付档案`。
3. 学生与项目清单 JSON。

清单可沿用现有班级数据，也可参考 [roster.example.json](references/roster.example.json)。至少要有学生姓名和项目名称；小名、旧题目或文件夹简称放入 `aliases` 和 `project_aliases`。

#### 2. 生成预演计划

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

#### 3. 检查预演计划

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

#### 4. 获得确认后执行

向老师展示简短变更摘要并明确等待确认。确认后运行：

```bash
node scripts/organize-materials.mjs apply --plan "整理预演.json" --confirm
```

执行只处理 `ready` 和 `approved` 项；`needs_review` 保持原位。每个学生档案写入 `整理归档记录.jsonl`，计划旁生成执行结果 JSON。

#### 5. 核验结果

```bash
node scripts/organize-materials.mjs audit \
  --archive-root "项目交付档案" \
  --roster "学生项目清单.json" \
  --output "档案检查.json"
```

报告每名学生各目录文件数、缺少的必交项、`99 待确认` 数量和重复哈希。检查结果只说明材料整理状态，不自动判断图片、视频或项目效果。

### 判断优先级

1. 人工覆盖规则。
2. 路径中的学生姓名、小名、项目名。
3. 文件夹和文件名中的材料关键词。
4. 扩展名。
5. 无法可靠判断则待确认。

详细分类、命名标签和扩展名规则见 [archive-schema.json](references/archive-schema.json)。

## 当前边界

本版本负责材料整理、复制、去重、命名、记录、缺项检查、学生答辩准备交接，以及基于教师事实生成每日回课草稿。它不自动检查图片和视频质量，不判断项目效果，不在教师端复制一套答辩生成器，不替老师发送家长消息，也不在未经确认时把回课写入学生档案。
