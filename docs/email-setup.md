# 邮箱与课程订阅配置

本文以 QQ 邮箱为例，说明 GitHub Actions 的邮箱配置、课程发现和订阅管理。所有设置都应在使用者自己的 Fork 中完成。

## 1. 获取 SMTP 授权码

1. 登录自己的 QQ 邮箱网页版。
2. 打开 **设置 → 账户** 或 **账号与安全**。
3. 找到 **POP3/IMAP/SMTP**、**SMTP 服务** 或第三方客户端设置。
4. 按邮箱提示开启 SMTP 并完成安全验证。
5. 生成并保存 SMTP 授权码。

`SMTP_PASSWORD` 必须填写邮箱生成的授权码，不是 QQ 登录密码或邮箱网页登录密码。不要把授权码提交到代码、Issues 或聊天记录中。

## 2. Fork 项目并启用 Actions

1. 在 GitHub 项目页点击 **Fork**，复制到自己的账号。
2. 进入自己的 Fork，打开 **Actions** 并启用工作流。
3. 打开 **Settings → Actions → General → Workflow permissions**，允许工作流读写仓库内容（Read and write permissions）。

## 3. 配置邮箱 Secrets

打开 **Settings → Secrets and variables → Actions → Secrets → New repository secret**，逐个添加：

| Name | Secret 内容 |
| --- | --- |
| `SMTP_EMAIL` | 发件邮箱完整地址，例如自己的 QQ 邮箱 |
| `SMTP_PASSWORD` | 第 1 步生成的 SMTP 授权码 |
| `RECEIVER_EMAIL` | 收件邮箱；可与发件邮箱相同，多个地址用英文逗号分隔 |

QQ 邮箱通常不需要额外设置服务器参数，默认值为 `SMTP_HOST=smtp.qq.com`、`SMTP_PORT=465`。其他邮箱请填写其官方 SMTP SSL 地址和端口。

## 4. 发送测试邮件

1. 打开 **Actions → Course files and email**。
2. 点击 **Run workflow**。
3. `operation` 选择 `mail-test`，然后运行。
4. 等待 `Check email only` 步骤完成，并检查收件箱和垃圾邮件夹。

该操作只测试 SMTP，不会登录超星、读取课程或下载视频。步骤变绿表示 SMTP 服务器接受了邮件；仍应检查收件箱确认实际投递。

## 5. 配置超星账号和课程入口

仍在 **New repository secret** 中添加：

| Name | 填写内容 |
| --- | --- |
| `COURSE_ACCOUNT` | 本人的超星账号；按学校实际登录方式填写手机号、邮箱或账号名 |
| `COURSE_PASSWORD` | 对应的超星登录密码 |
| `COURSE_ENTRY_URL` | 本人登录后打开的智播课堂课程列表完整链接 |
| `COURSE_FID` | 可选；仅在学校登录流程要求机构编号时填写 |
| `STATE_KEY` | 建议设置为密码管理器生成的长期随机字符串 |

`COURSE_ENTRY_URL` 应从本人正常登录后的智播课堂课程列表页面复制，并保留完整 URL 参数。不要使用他人的课程入口链接。

有些学校使用校园统一认证、验证码或二次验证，云端账号密码登录不一定适用。遇到此类情况，可在本机使用浏览器登录模式；不要把学校登录凭据交给他人代配置。

## 6. 发现课程 ID

1. 打开 **Actions → Course files and email → Run workflow**。
2. `operation` 选择 `discover`。
3. 运行后查看日志中的 `courseinfoid` 和课程名称。

第一次执行时，程序会在当前 Fork 中创建独立的 `data` 分支和空的 `data/subscriptions.json`。课程发现只读取课程列表，不下载视频。

**公开仓库的 Actions 日志可能对公众可见。** `discover` 日志会显示课程名称和 ID。如果不希望公开课程名称，请在本机运行 `node src/cli.mjs discover "课程列表链接"`，在本地查看生成的 `local-data/catalog.private.json`。

## 7. 设置长期订阅

在自己的仓库切换到 **`data` 分支**，编辑 `data/subscriptions.json`：

```json
{
  "course_ids": [
    "40243",
    "38135"
  ]
}
```

数组中的值是课程列表接口返回的 `courseinfoid`，必须使用数字字符串。提交修改后，这些课程成为长期订阅。

无需设置 `COURSE_IDS` Secret。GitHub Actions 会从当前 Fork 的 `data/subscriptions.json` 读取课程 ID。`COURSE_IDS` 仅作为本地/ROG `.env` 的回退配置。

## 8. 运行课程归档

再次运行 **Course files and email**：

- `operation` 选择 `run`，处理长期订阅课程。
- 第一次建议 `max_lectures=1`，确认附件正确后再增加。
- 若只想临时处理其他课程，选择 `single`，在 `course_ids` 输入框填写逗号分隔的 `courseinfoid`。已有订阅文件时，这不会修改长期订阅。

`max_lectures` 限制的是本轮处理的课节/回放数量，不是课程数。系统会跳过已完成的发送渠道，并优先处理日期较新的回放。

也可以设置 `COURSE_REPLAY_URL` Secret 指定单节「观看回放」链接。设置后会优先处理该回放，并绕过课程订阅；恢复批量订阅前请删除该 Secret。

## 9. 启用定时检查

确认手动归档成功后，打开 **Settings → Secrets and variables → Actions → Variables → New repository variable**：

- Name：`RUN_SCHEDULED`
- Value：`true`

默认每天 UTC 12:23（北京时间 20:23）运行。可选添加 `MAX_LECTURES` Variable 调整每轮最多处理的课节数，默认 3。定时任务可能延迟，可随时手动运行。

## 10. 数据分支与安全

每个 Fork 独立维护 `data` 分支：

- `data/subscriptions.json`：明文课程 ID 列表。
- `data/delivery-state.enc`：加密的回放处理和发送记录。

如果仓库是公开的，课程 ID 列表也是公开的。不要把账号、密码、邮箱授权码、GitHub Token 或其他秘密写入该分支。建议设置并长期保留 `STATE_KEY`；如果未设置，发送记录密钥会从超星账号和密码派生，修改密码后可能无法解密旧记录。

旧版本使用 `archive-state` 分支保存加密发送记录。升级后的程序会读取旧记录，并在后续成功发送时迁移写入 `data` 分支；旧分支不会自动删除。

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| SMTP 认证失败 | 检查是否填写授权码、SMTP 是否已开启、发件邮箱地址是否正确 |
| 测试邮件显示成功但未收到 | 检查收件地址、垃圾邮件夹和邮箱拦截设置 |
| 课程发现提示入口不可用 | 重新登录超星，从本人当前智播课堂课程列表复制完整 URL |
| 登录要求验证码或二次验证 | 使用本机浏览器登录模式；云端账号密码登录不保证支持学校统一认证 |
| 课程 ID 不在可访问列表 | 确认 ID 来自当前账号、当前课程列表和正确学期；检查是否已失去课程访问权限 |
| 没有找到可处理回放 | 该课节可能尚未发布回放，或平台未提供可用的观看回放链接 |
| 视频下载超时 | 学校视频域名可能只允许校内网络访问；改用具备访问条件的本机/ROG 网络 |
| 发送记录无法解密 | 使用最初设置的 `STATE_KEY`；不要删除加密状态后直接重跑 |

请遵守学校平台使用规范，仅处理本人获授权访问的课程内容，并妥善管理账号凭据和加密密钥。
