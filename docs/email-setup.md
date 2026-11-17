# 邮箱与 GitHub Secrets 配置

以下按 QQ 邮箱举例。朋友只需要浏览器，不需要在电脑安装编程环境。发件人和收件人可以使用同一个邮箱，最容易先验证。

## 1 获取邮箱授权码

1. 在电脑浏览器登录自己的 **QQ 邮箱网页版**。
2. 进入邮箱的 **设置**，寻找 **账户** 或 **账号与安全**。不同版本界面名称可能不同。
3. 在设置里找 **POP3/IMAP/SMTP**、**SMTP 服务** 或 **第三方客户端**。
4. 开启 SMTP，按邮箱提示完成手机或安全验证。
5. 点 **生成授权码**。保存邮箱给出的那一串字符。

这串字符才是 `SMTP_PASSWORD`。**不要在这里填写 QQ 登录密码或邮箱网页登录密码。** 不要把授权码发到聊天、Issues 或代码里。忘记授权码可在邮箱设置中重新生成，再更新仓库 Secret。

如果找不到入口，在 QQ 邮箱官方帮助里搜索「SMTP」「授权码」：<https://service.mail.qq.com/>。

## 2 Fork 并启用 Actions

1. 打开本项目的 GitHub 仓库，点右上角 **Fork**。
2. 确认仓库 Owner 是自己的 GitHub 账号，再点 **Create fork**。
3. 进入复制好的仓库，点顶部 **Actions**。
4. 如果看到工作流启用提示，点确认启用。

后续都在**自己的 Fork**里操作。不要把账号和授权码填到原作者的公开文件中。

## 3 添加邮箱 Secrets

打开自己仓库：

**Settings → Secrets and variables → Actions → Secrets → New repository secret**。

每次添加一个：Name 输入左侧名称，Secret 输入右侧自己的内容，再点 **Add secret**。

| Name | Secret 填写内容 | 例子 |
| --- | --- | --- |
| `SMTP_EMAIL` | 发送邮件的完整邮箱地址 | `你的QQ号@qq.com` |
| `SMTP_PASSWORD` | 第 1 步生成的授权码 | 邮箱给出的那串字符 |
| `RECEIVER_EMAIL` | 接收资料的完整邮箱地址 | 可以仍填自己的 QQ 邮箱 |

使用 QQ 邮箱时，下面两个可以不加；需要显式设置时填写：

| Name | QQ 邮箱取值 |
| --- | --- |
| `SMTP_HOST` | `smtp.qq.com` |
| `SMTP_PORT` | `465` |

这些名称区分大小写，建议直接复制，不要加空格或中文引号。GitHub 保存后不会再显示原值，这是正常现象。改错了可以点对应 Secret 的编辑按钮重新填写。

程序同时兼容 `SMTP_USERNAME` 作为 `SMTP_EMAIL` 别名、`MAIL_TO` 作为 `RECEIVER_EMAIL` 别名。若同时填写，前者优先；最简单的是只填本文使用的名称。

## 4 只发一封测试邮件

1. 点仓库顶部 **Actions**。
2. 左侧点 **Course files and email**。
3. 点右侧 **Run workflow**。
4. `operation` 选 **mail-test**，然后点运行。
5. 打开刚出现的运行记录，等待 **Check email only** 变绿。
6. 检查收件箱和垃圾邮件夹，应该看到「课程归档邮箱测试」。

这个模式只测试邮箱，不登录课程、不下载视频，也不需要先填超星密码。

变绿表示 SMTP 服务器接收了邮件；最终是否进入收件箱还取决于邮箱投递。确认实际收到再做下一步。

## 5 添加课程登录与范围

仍在 **New repository secret** 里逐个添加：

| Name | 填什么 |
| --- | --- |
| `COURSE_ACCOUNT` | 本人学习通绑定的手机号 |
| `COURSE_PASSWORD` | 本人超星账号对应密码 |
| `COURSE_ENTRY_URL` | 本人正常登录后，在智播课堂「我的课程」页复制的**完整链接** |
| `COURSE_QUERY` | 想处理的课程名称或足够明确的关键词 |
| `STATE_KEY` | 自己生成并保存的一段随机字符串，例如密码管理器生成的 32 字符字符串 |

课程入口应是 `https://fanyalubodata.fanya.chaoxing.com/starcloud/list...`。请完整复制自己能打开的链接，保留后面的参数，不要拿别人账号的链接填入。

如果用机构学号登录，可能还需要 `COURSE_FID`，它是超星机构编号，不是学号。常规绑定手机号通常不需要填。学校只允许校园统一认证时，可切到 ROG 本地登录模式。

只测试一节回放时，可以加 `COURSE_REPLAY_URL`，内容是点击「观看回放」后地址栏里的完整链接。设置此项后会忽略课程列表和关键词。测试完若要恢复课程订阅，请删除这个单节 Secret。

## 6 开始处理课程

再次运行 **Course files and email**：

- `operation` 选 **run**。
- 第一次 `max_lectures` 保持 **1**。
- 等待抓取、提取和发送完成，再检查邮件附件。

每节课最终是一个 `.pptx` 和一个 `.docx`。原视频较长时，处理可能需要较长时间。程序日志只报告进度，不输出密码或字幕正文。

## 7 每天自动检查

确认手动处理成功后：

1. **Settings → Secrets and variables → Actions → Variables**。
2. 点 **New repository variable**。
3. Name 填 `RUN_SCHEDULED`，Value 填 `true`。
4. 可选再添加 `MAX_LECTURES`，Value 填每轮最多处理几节，例如 `3`。

默认定时点为 **UTC 12:23，每天一次**。开启后需要等下一次定时事件；不是点保存立即执行。可随时手动运行。删除或改为 `false` 即关闭定时。

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| `SMTP 认证失败` | 确认填的是授权码；SMTP 已开启；发件邮箱完整且没有空格；重新生成授权码后更新 Secret |
| 没找到 `Course files and email` | 检查是否在自己的 Fork，Actions 是否启用，工作流是否在默认分支 |
| 邮箱步骤绿了但收不到 | 检查 `RECEIVER_EMAIL` 拼写、垃圾邮件夹和邮箱拦截设置；先改成发给自己再测试 |
| 提示验证码或二次验证 | 这是平台登录限制；先在本人浏览器确认账号状态，必要时用 ROG 本地登录环境运行 |
| 登录成功但找不到课程 | 更新本人当前课程列表完整链接；检查课程关键词和学期；回放必须已经发布 |
| 视频下载网络超时 | 学校视频域名可能只有校内或本人网络可访问；改用具备访问条件的 ROG |
| 单附件超过大小限制 | 默认每封原始附件合计 18 MiB，考虑 MIME 膨胀；程序会自动分邮件，单文件仍过大时可改用 ROG QQ |
| 想修改收件人并重发旧课 | 先保留备份，再有选择地清除该课发送状态；不要直接删整个状态分支导致全部重发 |
| 换了超星密码后状态解密失败 | 若最初设置了独立 `STATE_KEY`，保持它不变；未设置则需用旧账号密码派生的旧密钥恢复，不能当首次运行忽略错误 |

本地 ROG 可以复制同样的邮箱参数到 `.env`。发送前执行 `scripts/run.ps1 -MailTest`。

GitHub 官方说明：[Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)、[Variables](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables)、[手动与定时触发](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)。
