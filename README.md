# 超星智播课堂课程归档

从本人有权限访问的超星「智播课堂」回放中获取平台字幕和电脑录屏，自动整理为两份文件：

- **PPTX 课件**：按首次出现顺序整理课件画面，每张独立一页。
- **DOCX 图文讲义**：嵌入课件图片，并将对应时间段的平台字幕归集到图片下方。

项目不调用语音识别模型、OCR 模型、LLM 或 AI API。PPTX 中的文字和图形来自录屏截图，不会自动转换成可编辑的 PowerPoint 对象。

## 功能与适用范围

- 自动发现当前账号在智播课堂课程列表中可访问的课程。
- 按课程 ID 选择长期订阅课程，也支持临时指定课程。
- 只处理符合平台发布条件、存在可用回放链接的课节。
- 自动提取电脑录屏中的课件页面，保留回翻页的时间顺序。
- 每节回放生成 PPTX 和 DOCX；支持邮件或本机 OneBot/NapCat 发送。
- 支持 GitHub Actions 定时增量处理，也支持 Windows、macOS 和 Linux 本地运行。

课程发现范围取决于超星账号当前能访问的智播课堂课程列表。它不等于学校所有课程，也不保证自动枚举账号历史上所有学期的课程。不同学校的登录方式和平台部署可能存在差异。

## GitHub Actions 快速开始

### 1. Fork 并启用 Actions

1. 点击右上角 **Fork**，将项目复制到自己的 GitHub 账号。
2. 后续配置都在自己的 Fork 中进行，不要把账号凭据提交到代码或 Issues。
3. 打开 **Actions**，按 GitHub 提示启用工作流。
4. 进入 **Settings → Actions → General → Workflow permissions**，允许工作流读写仓库内容（Read and write permissions）。项目需要在自己的仓库中创建和更新 `data` 分支。

### 2. 配置 Secrets

进入 **Settings → Secrets and variables → Actions → Secrets → New repository secret**，按需添加：

| Secret | 必需性 | 内容 |
| --- | --- | --- |
| `COURSE_ACCOUNT` | 登录必需 | 本人的超星账号；具体可以是手机号、邮箱或学校支持的账号形式 |
| `COURSE_PASSWORD` | 登录必需 | 对应的超星登录密码 |
| `COURSE_ENTRY_URL` | 课程发现必需 | 本人登录后打开的智播课堂课程列表完整链接 |
| `COURSE_FID` | 可选 | 学校或机构编号；只有登录流程需要时才填写，普通绑定手机号账号通常留空 |
| `SMTP_EMAIL` | 邮件发送必需 | 发件邮箱完整地址 |
| `SMTP_PASSWORD` | 邮件发送必需 | 邮箱生成的 SMTP 授权码，不是邮箱网页登录密码 |
| `RECEIVER_EMAIL` | 邮件发送必需 | 收件邮箱；可以与发件邮箱相同，多个地址用英文逗号分隔 |
| `STATE_KEY` | 建议 | 独立、长期保留的随机字符串，用于加密发送记录 |

可选邮件参数：`SMTP_HOST`、`SMTP_PORT`。默认使用 QQ 邮箱的 `smtp.qq.com:465`。其他邮箱请填写服务商提供的 SMTP 地址和端口。

`COURSE_ENTRY_URL` 应从本人正常登录后的智播课堂课程列表页面复制，保留完整 URL 参数。不要使用其他人的课程入口链接。

部分学校使用校园统一认证、验证码或二次验证。云端账号密码登录不能保证兼容所有学校；遇到此类限制时，请使用本机浏览器登录方式，或确认学校允许的登录流程。

### 3. 测试邮件

进入 **Actions → Course files and email → Run workflow**：

- `operation` 选择 `mail-test`。
- 点击 **Run workflow**。
- 等待 `Check email only` 步骤完成，并确认实际收到测试邮件。

邮件测试不登录超星，也不下载课程资料。

### 4. 发现本人可访问的课程

再次进入 **Actions → Course files and email → Run workflow**：

- `operation` 选择 `discover`。
- 运行后查看日志中的课程 ID 和课程名称。

课程 ID 来自超星课程列表接口的 `courseinfoid`。第一次执行时，程序会在当前 Fork 中自动创建独立的 `data` 分支和空订阅文件；课程发现本身不会下载视频或生成文档。

**隐私提示：** 如果 Fork 是公开仓库，GitHub Actions 日志也可能对公众可见。课程发现日志会显示课程名称和 ID；如果不希望公开这些信息，请使用本机 CLI 发现课程，而不要在公开 Actions 日志中输出课程目录。

### 5. 设置长期订阅课程

在自己的仓库切换到 **`data` 分支**，打开 `data/subscriptions.json` 并编辑 `course_ids` 数组。例如：

```json
{
  "course_ids": [
    "40243",
    "38135",
    "37695"
  ]
}
```

将需要归档的 `courseinfoid` 填入数组。课程 ID 使用字符串形式，必须是数字；重复 ID 会被去重。提交修改后，这些课程就成为该 Fork 的长期订阅。

**不需要创建 `COURSE_IDS` Secret。** GitHub Actions 会从当前 Fork 自己的 `data/subscriptions.json` 读取长期订阅列表。

### 6. 运行归档

回到 **Actions → Course files and email → Run workflow**：

- `operation` 选择 `run`，按 `max_lectures` 设置本轮最多处理的课节数。
- 第一次建议保持默认值 `1`，确认邮件附件正确后再增加。

每轮先发现订阅课程中的已发布回放，再排除已完成的发送记录，按回放日期从新到旧处理。`max_lectures` 的单位是**课节/回放**，不是课程数。

如果只想临时处理其他课程，选择 `single` 并在 `course_ids` 中填写逗号分隔的课程 ID。已有 `data/subscriptions.json` 时，这次选择不会修改长期订阅。首次运行若尚无订阅文件，`single` 输入会用于初始化订阅；初始化后需要再次运行才开始处理。

也可以设置 `COURSE_REPLAY_URL` Secret，直接指定一节「观看回放」链接。设置后会优先处理这一节，并绕过课程列表和课程订阅；恢复批量订阅前请删除该 Secret。

### 7. 启用每日自动检查

确认手动运行成功后，进入 **Settings → Secrets and variables → Actions → Variables → New repository variable**：

- Name：`RUN_SCHEDULED`
- Value：`true`

默认定时点为每天 **UTC 12:23（北京时间 20:23）**。可选设置 `MAX_LECTURES`，控制每轮最多处理多少节；默认 3。GitHub 定时任务可能延迟，启用后请观察一次实际运行。

## 课程 ID 与回放 ID

项目区分两个层级：

| 标识 | 超星字段 | 用途 |
| --- | --- | --- |
| 课程 ID | `courseinfoid` | 选择要订阅的课程，保存在 `data/subscriptions.json` |
| 回放 ID | `speechid` | 唯一标识一节回放，用于增量处理记录和本地输出目录 |

不要把 `speechid` 填入 `course_ids`。不同平台的课程 ID 也不通用；本项目使用超星智播课堂接口返回的 `courseinfoid`。

## 分支与数据安全

每个 Fork 有自己的 `data` 分支，与程序所在的 `main` 分支分离：

| 路径 | 内容 |
| --- | --- |
| `main` | 程序、测试、文档和 GitHub Actions 工作流 |
| `data/subscriptions.json`（`data` 分支） | 用户选择的课程 ID，明文 JSON |
| `data/delivery-state.enc`（`data` 分支） | 已处理/已发送记录，加密保存 |

`data` 分支会在第一次执行 `discover`、`run` 或 `single` 时由当前 Fork 自动创建。不要把其他用户的 `data` 分支复制到自己的仓库。

如果仓库是公开的，`data/subscriptions.json` 中的课程 ID 也是公开的。不要在其中填写账号、密码、邮箱授权码或其他秘密。超星凭据和邮箱授权码必须保存在 GitHub Secrets 中。建议设置独立 `STATE_KEY` 并长期保留；如果未设置，发送记录密钥会从超星账号和密码派生，修改密码后可能无法解密旧记录。

旧版本曾将加密发送记录保存在 `archive-state` 分支。升级后的程序会读取旧记录，并在后续成功发送时迁移写入 `data` 分支；旧分支不会被自动删除。

课程视频、字幕、生成文档和浏览器登录目录不会提交到公开仓库，也不会上传为公开 Actions Artifact。它们只保存在被 Git 忽略的 `local-data/` 中，或通过配置的私有发送渠道交付。

## 本地或 ROG 运行

需要 Node.js 22+、Python 3.11+、FFmpeg/ffprobe。安装依赖：

```bash
npm ci
uv sync --locked
```

复制 `.env.example` 为 `.env`，填写超星账号、密码和课程入口。`.env` 不要提交到 Git。

本地查看课程 ID：

```bash
node src/cli.mjs discover "智播课堂课程列表链接"
```

或运行：

```bash
node src/run.mjs --discover
```

如果首次需要交互式登录，将 `COURSE_HEADLESS=false`，在弹出的浏览器中正常登录；之后可恢复 `true` 复用项目独立浏览器配置。浏览器配置保存在 `local-data/`，不要分享或提交。

本地/ROG 没有 GitHub 订阅分支时，可以在 `.env` 中使用 `COURSE_IDS=课程ID1,课程ID2` 作为本地回退配置。GitHub Actions 不读取这个变量，而以 `data/subscriptions.json` 为准。

正式运行：

```bash
node src/run.mjs
```

输出文件位于 `local-data/final/<回放编号>/`。`DELIVERY=none` 只生成本地文件；`email` 发送邮件；`qq` 通过本机 OneBot/NapCat 发送；`both` 使用两种渠道。Windows 可使用 `scripts/run.ps1`，macOS/Linux 可使用 `scripts/run.sh`。

## 单节回放命令

```bash
node src/cli.mjs inspect "观看回放链接"
node src/cli.mjs capture "观看回放链接" --out local-data/final/example
node src/cli.mjs build local-data/jobs/回放编号 --out local-data/final/回放编号
```

`inspect` 只检查课程信息、视频流和字幕，不下载视频。`capture` 完整处理一节课；`build` 从已有本地中间数据重新生成文档。

## 验证与开发

```bash
npm test
uv run --locked python -m unittest discover -s test -p "test_*.py" -v
node test/smoke.mjs
```

本地已用真实智播课堂回放验证课件提取和 Office 文档生成；账号登录、SMTP 实际收件以及具体学校的访问权限仍需使用者自己的账号和网络环境验收。

## 使用边界

请遵守学校平台使用规范和适用的著作权要求，仅处理本人获授权访问的课程内容，用于个人学习。不要未经许可传播课程录屏、字幕、课件或生成文档。请妥善管理账号凭据、GitHub Token、SMTP 授权码和加密密钥。
