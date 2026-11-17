# 超星智播课堂 课件与图文讲义

从本人有权限的智播课堂回放中获取平台已有字幕，下载电脑录屏，自动整理成两个文件：

1. **PPTX 课件**：课件画面按首次出现顺序去重，每张图片独立占一页，方便自行删改。
2. **DOCX 图文讲义**：先放一页课件图片，再放该页对应时段的讲解；回翻到同一页的讲解会归集到这页下面。

图片嵌在 Word 内，不需要 Markdown 查看器或额外图片目录。语音文字直接来自超星，不需要语音模型、LLM 或 AI API Key。PPTX 恢复的是录屏页面图像，可删除、排序、替换图片，原图里的文字和图形不会自动成为可编辑对象。

默认全自动处理：换页检测、稳定画面取样、鼠标移动抑制、保守去重、可靠时裁切。明显短暂过渡会跳过；网页、视频中难以判断的画面保留。没有人工选图步骤。

## 给朋友的最短操作路径

1. 点右上角 **Fork**，复制到自己的 GitHub 账号。
2. 打开自己仓库的 **Actions**，启用工作流。
3. 按 [邮箱和 Secrets 配置说明](docs/email-setup.md) 填入账号、密码、课程入口和邮箱授权码。
4. 在 **Actions → Course files and email → Run workflow** 里先选 **mail-test**。
5. 测试邮件收到后，再选 **run**，第一次保持 **max_lectures=1**。
6. 检查附件后，如需每日自动检查，在仓库 Variables 里设置 `RUN_SCHEDULED=true`。

**只添加 Secrets 不会自动触发一次抓取**。第一次请手动运行。每节课处理完成后，邮箱收到 PPTX 和 DOCX，附件较大时会分成两封邮件。邮箱可与发送邮箱相同。

## GitHub Secrets

详细界面路径与逐项示例见 [邮箱配置](docs/email-setup.md)。

| 名称 | 是否必需 | 内容 |
| --- | --- | --- |
| `COURSE_ACCOUNT` | 账号登录时必需 | 学习通绑定的手机号，或受支持的机构账号 |
| `COURSE_PASSWORD` | 账号登录时必需 | 对应超星密码 |
| `COURSE_ENTRY_URL` | 课程发现时必需 | 从本人浏览器复制的完整「智播课堂」课程列表链接 |
| `COURSE_QUERY` | 建议填写 | 课程名称关键词，留空会枚举本人课程 |
| `COURSE_FID` | 可选 | 机构编号；绑定手机号通常留空，默认 `-1` |
| `COURSE_REPLAY_URL` | 可选 | 单节「观看回放」完整链接；设置后优先处理这一节 |
| `SMTP_EMAIL` | 邮件发送必需 | 发件邮箱，例如自己的 QQ 邮箱完整地址 |
| `SMTP_PASSWORD` | 邮件发送必需 | 邮箱生成的 **SMTP 授权码**，不是网页登录密码 |
| `RECEIVER_EMAIL` | 邮件发送必需 | 收件邮箱，多个地址用英文逗号分隔 |
| `SMTP_HOST` | 可选 | 默认 `smtp.qq.com` |
| `SMTP_PORT` | 可选 | 默认 `465`；也支持使用 STARTTLS 的 `587` |
| `STATE_KEY` | 建议设置 | 自己保存的一段足够长的随机字符串，用于加密发送记录 |

也兼容 `SMTP_USERNAME` / `MAIL_TO` 这组别名，便于从其他工具迁移。邮箱字段沿用个人 iCourse Subscriber 的 `SMTP_EMAIL / SMTP_PASSWORD / RECEIVER_EMAIL` 约定。

`STATE_KEY` 留空时按 iCourse 的 ICSv2 约定从超星账号和密码派生。之后修改超星密码会改变派生密钥；建议一开始就设置独立 `STATE_KEY` 并长期保留。加密记录存在 `archive-state` 分支，里面不存课程内容或邮箱授权码。程序使用普通提交更新，不 force push。

## 定时与重跑

`RUN_SCHEDULED` 是 **Variable**，不是 Secret。默认关闭，每天触发点为 UTC 12:23。启用后每轮默认最多处理 3 节，可用 Variable `MAX_LECTURES` 调整；手动运行时以表单数字为准。

按最近日期优先处理未完成回放。每完成一个发送渠道立即写入状态；重跑会继续未完成项。SMTP 已接收但状态尚未写回时发生断电，或收件方/渠道配置改变后，仍可能需要人工核对。GitHub 定时任务可能延迟，首次启用后应实际观察一轮。

不会把课程视频、字幕或文档发布到公开仓库、Release、Pages 或公开 Actions 附件。公开仓库只包含程序、测试和说明。

## ROG 或本机运行

使用同一套代码，不依赖 GitHub 在线执行。Windows 推荐放在：

```text
C:\Users\Meta\Project\Workspaces\chaoxing-course-archive
```

安装依赖前需要已有 Node.js 22+、uv、FFmpeg/ffprobe；环境安装遵循自己的版本管理方式。项目本身只安装隔离依赖：

```powershell
npm ci
uv sync --locked
Copy-Item .env.example .env
```

编辑 `.env`，填好配置。然后：

```powershell
# 只测试邮箱
.\scripts\run.ps1 -MailTest

# 抓取、处理、按配置发送
.\scripts\run.ps1
```

`DELIVERY=none` 只产出本地文件；`email` 发邮箱；`qq` 经本机 OneBot/NapCat 发 QQ 文件；`both` 两种都发。QQ 配置与 Windows 任务计划说明见 [ROG 运行说明](docs/rog.md)。

macOS/Linux 使用 `bash scripts/run.sh`，邮箱测试用 `bash scripts/run.sh --mail-test`。

完成文件在 `local-data/final/<回放编号>/`。每个课节目录只有两个最终文件；原录屏、字幕和处理数据在 `local-data/jobs/`。这些目录均被 Git 忽略。

没有配置账号密码时，可以先用本机独立浏览器完成一次正常登录：

```text
node src/cli.mjs discover "本人课程列表链接" --query "课程关键词"
```

后续在 `.env` 中设置 `COURSE_HEADLESS=true` 可复用该独立浏览器环境。不要把浏览器登录目录提交或发送给别人。云端账号登录只支持超星常规账号密码流程；校园单点登录、验证码和二次验证需在本机完成，不能承诺仅填账号密码就适配每所学校。

## 单节命令

```text
node src/cli.mjs inspect "观看回放链接"
node src/cli.mjs capture "观看回放链接" --out local-data/final/example
node src/cli.mjs build local-data/jobs/回放编号 --out local-data/final/回放编号
```

`inspect` 显示课程基本信息、视频通道和字幕数量，不下载视频。`capture` 完整处理一节课。`build` 从已经提取的本地数据重新生成两份文件。

## 当前验证边界

本地已使用一节约 50 分钟、1920×1080、259 段平台字幕的真实回放跑通课件提取与两种 Office 文档生成。合成录屏验证移动鼠标不会额外生成页面，A-B-A 回翻页时间事件保留，讲解不会因去重丢失。

CI 会检查公开代码与生成文件结构。账号密码的真实云端登录、SMTP 实际收件和 ROG QQ 实际发送，必须用使用者自己的 Secrets/本机配置进行验收。无法访问校内视频域名时，使用能访问该域名的 ROG 运行。

## 开发检查

```text
npm test
uv run --locked python -m unittest discover -s test -p "test_*.py" -v
node test/smoke.mjs
```

使用 MIT `video-slide-extractor` 作为换页检测底层，配合 FFmpeg、Sharp、PptxGenJS 和 python-docx。复用来源、接口和时间轴规则见 [实现设计](docs/design/pipeline.md) 与 [iCourse 复用记录](docs/design/icourse-reuse.md)。
