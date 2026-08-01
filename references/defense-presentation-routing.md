# 学生答辩准备协同

本文件只规定教师端如何把已归档材料交给学生端，不复制学生答辩生成器。

## 分工

- `suitangtiaoshi-skill`：教师批量整理、核对归属、标记缺项并完成归档。
- `idealab-student-skills`：学生唯一入口；自动调用其内置 `defense-presentation` 模块生成答辩演示、逐页参考稿、素材盘点和练习页。
- 不要求学生记住 `defense-presentation` 名称，也不在教师 Skill 内维护第二套生成器。

## 教师端流程

1. 对目标学生档案运行归档检查，确认姓名、项目名称和目录归属。
2. 单独报告开题书、图纸、制作过程、原型、实验、视频和已有答辩材料的数量。
3. 材料存在不等于画面含义正确；需要人工确认的内容保持 `待确认`。
4. 告诉学生在自己的项目目录中调用 `idealab-student-skills`，自然表达“帮我准备最终答辩”。
5. 学生端会先输出素材盘点并等待确认，确认后才生成最终演示。

## 共同逻辑

答辩必须保留：

```text
目标人群的问题
→ 现有方案与不足
→ 本项目功能怎样回应不足
→ 形成什么亮点或创新
→ 用什么实验验证核心目标
```

调研页没有真实材料时可以省略。原型、制作过程和实验素材缺失时保留待补占位，不使用AI图片冒充证据。

## 版本检查

学生端仓库：`https://github.com/Amasun93/idealab-student-skills`

WorkBuddy 更新 `idealab-student-skills` 后，应运行：

```bash
node scripts/manage-bundled-skills.mjs check defense-presentation
```

检查通过只表示模块文件完整，不表示某名学生的答辩素材已经齐全。
