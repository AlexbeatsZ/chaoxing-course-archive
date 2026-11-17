# 个人 icourse 实现复用

参考仓库：`AlexbeatsZ/Fudan_iCourse_Subscriber`，本地 checkout 名为 `icourse`，检查时 HEAD 为 `afcbd98e1542db01fefb425cbdb0edb3f494e132`。源项目只读，保留其已有改动与部署。

| 原实现 | 本项目复用 |
| --- | --- |
| `src/runtime/config.py` 邮箱配置 | 继续支持 `SMTP_EMAIL / SMTP_PASSWORD / RECEIVER_EMAIL`，QQ SMTP 默认值一致 |
| `src/api/emailer.py` SMTP SSL 发送 | 沿用标准库 SMTP 和邮箱授权码方式；邮件内容改为两份 Office 附件，新增 587 STARTTLS 与大小分批 |
| `src/data/crypto_box.py` | 将 ICSv2 密钥派生、100000 轮 PBKDF2、OpenSSL `Salted__` AES-256-CBC 封装移植到 Node `src/state.mjs` |
| `local_replay.py::write_json` | `src/platform.mjs::saveJson` 采用同样的写临时文件、flush/fsync、原子重命名策略 |
| `local_replay.py::download_video` | 采用字节范围、稳定版本校验、完整大小与完成记录，避免错误续传或覆盖未知成品 |
| `local_replay.py::timeline` 和 `docs/design/rog-library.md` | 保留时间 0 与回翻页事件，图片去重不删除时间事件，字幕使用原始精确时间 |
| `scripts/check_new_replays.py` | 轻量发现后才处理新课节；正常空结果和登录/网络错误分开，失败不会伪装成“没有新课” |
| `src/data/database.py` 的 `emailed_at` 与加密 data 分支 | 每个渠道成功后才记账，GitHub `archive-state` 独立分支持久保存加密记录，不依赖缓存长期有效 |

学校登录、课程发现接口不同：复旦 iCourse 的 WebVPN/CAS 不能直接用于超星。因此保留适配层，而不引入原仓库的 ASR、OCR、摘要模型或 WebVPN 专用依赖。

原仓库 README 与当前 AGENTS 状态存在历史表述差异：自动邮件已从其日常检查流程中停用，但 SMTP 导出代码和配置仍存在。本项目复用这些可用部分，不重新启用原有流程。

GitHub 状态更新使用普通 Contents API 提交和并发校验，不照搬原工作流里的 force push。
