# 本地运行与 QQ 文件发送

本地运行与 GitHub Actions 使用同一套课程归档代码。适合学校登录需要验证码、校园统一认证，或学校视频域名只能从本地网络访问的情况。

## 环境准备

需要 Node.js 22+、Python 3.11+、uv、FFmpeg 和 ffprobe。先安装项目依赖：

```bash
npm ci
uv sync --locked
```

Windows PowerShell 执行 `Copy-Item .env.example .env`；macOS / Linux 执行 `cp .env.example .env`。

在 `.env` 中填写超星账号和密码，`COURSE_ENTRY_URL` 默认留空。账号默认进入另一个单位时，填写学校的 `COURSE_FID`，例如浙江财经大学使用 `2128`。使用浏览器登录时，账号和密码两项留空。按需要填写邮件或 QQ 发送配置。不要将 `.env` 提交到 GitHub。

## 查找课程名称与 ID

首次使用浏览器登录时，需要安装 Chrome，清空账号和密码，并设置：

```dotenv
COURSE_HEADLESS=false
```

运行课程发现：

```powershell
node src/run.mjs --discover
```

使用浏览器模式时，请在弹出的 Chrome 中正常登录。程序会输出当前账号可访问的课程 ID 和名称，并在 `local-data/catalog.private.json` 保存本地课程目录。登录成功后，可将 `COURSE_HEADLESS` 改回 `true`，复用 `local-data/browser-profile`。

按课程名称选好课程，将对应 ID 填入 `.env`，多门课程用英文逗号分隔。下列数字仅作示例：

```dotenv
COURSE_IDS=10001,10002
```

本地运行从 `COURSE_IDS` 读取订阅；GitHub Actions 使用当前 Fork 的 `data/subscriptions.json`。两者都填写超星课程列表接口返回的 `courseinfoid`，不要填写课节 `speechid`。

## 运行与输出

```bash
node src/run.mjs
```

如果配置了邮箱，可先运行 `node src/run.mjs --mail-test`，确认能收到测试邮件。

每节回放的最终文件保存在 `local-data/final/<回放编号>/`，包含一个 PPTX 和一个 DOCX。视频、字幕、浏览器配置和中间数据保存在被 Git 忽略的 `local-data/` 中。

| `DELIVERY` | 效果 |
| --- | --- |
| `none` | 只生成本地文件 |
| `email` | 按 SMTP 配置发送邮件 |
| `qq` | 经本机 OneBot/NapCat 发送 QQ 私聊文件 |
| `both` | 邮箱和 QQ 分别发送，并分别记录成功状态 |

失败后再次运行会继续尚未完成的部分。若上次被强制结束而留下 `local-data/run.lock`，先确认没有正在运行的任务，再删除锁文件。

## QQ 自动发送

需要已有且已登录的 OneBot 11 / NapCat HTTP 服务；程序不会替使用者安装或修改 QQ 服务。

```dotenv
DELIVERY=qq
QQ_API_URL=http://127.0.0.1:3000
QQ_API_TOKEN=OneBot服务的访问令牌
QQ_TARGET_USER_ID=接收文件的QQ号
```

端口仅为示例，应填写服务实际监听地址。程序调用 `upload_private_file` 发送两份最终文件，不发送课程视频。

附件路径必须对 QQ 服务进程可读。如果 NapCat 与程序运行在不同容器或 WSL 环境，请将项目的 `local-data/final` 映射到服务可访问的位置，并设置 `QQ_FILE_ROOT` 为服务侧对应目录。

## 需要校园统一认证或验证码时

如果学校要求扫码、验证码或校园单点登录，可清空 `.env` 中的 `COURSE_ACCOUNT` 和 `COURSE_PASSWORD`，设置 `COURSE_HEADLESS=false`，再运行 `node src/run.mjs --discover` 或正式归档命令。在打开的独立 Chrome 中正常完成登录后，程序会复用该浏览器会话。

后续无人值守运行可将 `COURSE_HEADLESS` 改回 `true`。浏览器会话保存在 `local-data/browser-profile`，不要分享或提交该目录。

如果回放页必须依赖浏览器 Cookie，而平台签名链接无法独立读取，程序会明确报错，不会伪造空字幕或假装处理成功。

## 定时运行

先确认手动运行、文件生成和实际发送均成功，再自行配置 Windows 任务计划或系统定时任务。不要让同一项目同时启动多轮；浏览器交互登录路径需要有对应的桌面用户会话。
