"""SMTP delivery with TLS and bounded MIME messages. Credentials stay in env."""
import json
import mimetypes
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from pathlib import Path


def configuration(env=os.environ):
    # Compatible with the existing iCourse Subscriber Secrets, without importing
    # its ASR/OCR/LLM dependency graph.
    env = {**env, "SMTP_USERNAME": env.get("SMTP_USERNAME") or env.get("SMTP_EMAIL", ""),
           "MAIL_TO": env.get("MAIL_TO") or env.get("RECEIVER_EMAIL", ""),
           "SMTP_HOST": env.get("SMTP_HOST") or "smtp.qq.com"}
    required = ["SMTP_USERNAME", "SMTP_PASSWORD", "MAIL_TO"]
    missing = [key for key in required if not env.get(key)]
    if missing:
        raise ValueError("缺少邮箱配置: " + ", ".join(missing))
    port = int(env.get("SMTP_PORT") or "465")
    if port not in (465, 587):
        raise ValueError("SMTP_PORT 仅支持 TLS 465 或 STARTTLS 587")
    addresses = [s.strip() for s in env["MAIL_TO"].split(",") if s.strip()]
    if not addresses or any("@" not in s or "\n" in s or "\r" in s for s in addresses):
        raise ValueError("MAIL_TO 需填写有效邮箱，多人使用英文逗号分隔")
    return {"host": env["SMTP_HOST"], "port": port, "username": env["SMTP_USERNAME"],
            "password": env["SMTP_PASSWORD"], "sender": env.get("MAIL_FROM") or env["SMTP_USERNAME"], "recipients": addresses}


def plan_messages(files, limit):
    batches, batch, size = [], [], 0
    for file in files:
        file_size = Path(file).stat().st_size
        if file_size > limit:
            raise ValueError("单个附件超出邮件大小限制。文件已保留在本机，请提高合法限额或改用 ROG QQ 发送。")
        if batch and size + file_size > limit:
            batches.append(batch)
            batch, size = [], 0
        batch.append(Path(file))
        size += file_size
    if batch or not files:
        batches.append(batch)
    return batches


def build_messages(files, subject, body, config, limit):
    batches = plan_messages(files, limit)
    messages = []
    for i, batch in enumerate(batches):
        message = EmailMessage()
        message["From"] = config["sender"]
        message["To"] = ", ".join(config["recipients"])
        message["Subject"] = subject + (f" ({i + 1}/{len(batches)})" if len(batches) > 1 else "")
        message.set_content(body)
        for path in batch:
            kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            major, minor = kind.split("/", 1)
            message.add_attachment(path.read_bytes(), maintype=major, subtype=minor, filename=path.name)
        messages.append(message)
    return messages


def send(files=(), test=False):
    config = configuration()
    limit = int(float(os.environ.get("MAIL_MAX_RAW_MB", "18")) * 1024 * 1024)
    if limit <= 0:
        raise ValueError("MAIL_MAX_RAW_MB 必须大于 0")
    subject = "课程归档邮箱测试" if test else "课程资料已整理完成"
    body = "这是一封配置测试邮件。看到本邮件表示 SMTP 配置成功。" if test else (
        "本次课程资料已整理完成。附件为 PPTX 课件和 Word 图文讲义。\n"
        "讲义中的图片直接嵌入文档，文字按课件时间匹配。平台自动转录文字可能存在识别错误。\n"
        "附件较大时会拆成多封邮件，文件本身不会切碎。")
    messages = build_messages(list(files), subject, body, config, limit)
    tls = ssl.create_default_context()
    smtp_class = smtplib.SMTP_SSL if config["port"] == 465 else smtplib.SMTP
    options = {"context": tls} if config["port"] == 465 else {}
    with smtp_class(config["host"], config["port"], timeout=90, **options) as client:
        client.ehlo()
        if config["port"] == 587:
            client.starttls(context=tls)
            client.ehlo()
        client.login(config["username"], config["password"])
        for message in messages:
            refused = client.send_message(message, from_addr=config["sender"], to_addrs=config["recipients"])
            if refused:
                raise RuntimeError("部分收件人被邮件服务器拒绝，未标记为发送完成")
    print(json.dumps({"messages": len(messages), "attachments": len(files)}))


if __name__ == "__main__":
    try:
        send(sys.argv[1:] if "--test" not in sys.argv else (), test="--test" in sys.argv)
    except Exception as error:
        # SMTP responses can echo account addresses or provider internals.
        if isinstance(error, smtplib.SMTPAuthenticationError):
            print("SMTP 认证失败：请检查邮箱授权码，不要填写网页登录密码。", file=sys.stderr)
        elif isinstance(error, smtplib.SMTPException):
            print("SMTP 服务器拒绝发送，请检查服务是否开启、收件地址和附件大小。", file=sys.stderr)
        else:
            print(str(error), file=sys.stderr)
        sys.exit(1)
