# ROG 本地抓取与发送

ROG 和 GitHub 使用同一套代码，差别在配置来源和本地可用网络。当前文档提供运行入口，本轮没有安装 ROG 定时任务，也没有修改已有 icourse 部署。

## 初始化

将本项目放在 `C:\Users\Meta\Project\Workspaces\chaoxing-course-archive`。使用已有的 Node、uv 和 FFmpeg。依赖都放在项目内：

```powershell
npm ci
uv sync --locked
Copy-Item .env.example .env
```

用记事本或编辑器打开 `.env`，填写本人超星账号、课程入口和关键词。文件不要提交到 GitHub。

## 输出或发送

| `.env` 配置 | 效果 |
| --- | --- |
| `DELIVERY=none` | 只把两份文件留在 `local-data/final/<课节编号>/`，可自行拖到 QQ 发送 |
| `DELIVERY=email` | 按 SMTP 配置发送 |
| `DELIVERY=qq` | 经本机 OneBot/NapCat 自动发送 QQ 私聊文件 |
| `DELIVERY=both` | 邮箱和 QQ 分别发送，各自记录成功状态 |

运行 `powershell -File scripts/run.ps1`。失败后再次运行会继续尚未成功的部分。若上次被强制结束而留下 `local-data/run.lock`，先确认没有正在运行的任务，再删除锁文件。

## QQ 自动发送

需要已有、已登录的 OneBot 11 / NapCat HTTP 服务，程序不会替你安装或更改 QQ 服务。

```dotenv
DELIVERY=qq
QQ_API_URL=http://127.0.0.1:3000
QQ_API_TOKEN=你自己OneBot服务的访问令牌
QQ_TARGET_USER_ID=朋友的QQ号
```

端口只是示例，应填写已有服务实际的本地端口。程序调用 `upload_private_file`，上传两份最终文件；不发送课程视频。

附件路径必须对 QQ 服务进程可读。如果 NapCat 与本程序都直接运行在同一台 Windows，一般不需要 `QQ_FILE_ROOT`。如果 QQ 服务运行于 Docker/WSL，请把本项目 `local-data/final` 映射进容器，再把容器里的对应根目录填入 `QQ_FILE_ROOT`。它只负责把最终文件的相对路径转换到服务可读的路径。

## 本机浏览器登录备用路径

如果学校触发验证码、扫码或校园单点登录，可暂时清空 `.env` 中的 `COURSE_ACCOUNT` 和 `COURSE_PASSWORD`，并设置 `COURSE_HEADLESS=false`，运行抓取程序。在打开的独立 Chrome 中正常完成登录后，程序继续查课。后续无人值守运行改回 `COURSE_HEADLESS=true`，复用 `local-data/browser-profile`。

若回放页本身也强制依赖 Cookie，而签名链接无法独立读取，当前命令会明确失败，不会伪造无字幕结果。常规账号密码路径支持在抓取回放元数据时复用认证请求。

## 任务计划

确认单次运行与实际收件成功后，再自行添加 Windows 任务计划。程序：`powershell.exe`。参数示例：

```text
-NoProfile -File C:\Users\Meta\Project\Workspaces\chaoxing-course-archive\scripts\run.ps1
```

可配置每天一次；不要让同一项目同时启动多轮。浏览器备用路径需要交互用户登录环境。若希望由 Codex 实际部署定时任务，再明确指定运行时间和发送对象。
