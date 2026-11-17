import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("course_mail", Path(__file__).parents[1] / "src/mail.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MailTests(unittest.TestCase):
    def test_configuration_and_tls(self):
        env = dict(SMTP_HOST="smtp.test", SMTP_USERNAME="sender@example.com", SMTP_PASSWORD="authorization", MAIL_TO="friend@example.com")
        self.assertEqual(module.configuration(env)["port"], 465)
        self.assertRaises(ValueError, module.configuration, {**env, "SMTP_PORT": "25"})
        self.assertRaises(ValueError, module.configuration, {**env, "MAIL_TO": "bad\naddress"})

    def test_large_pair_splits_messages_without_splitting_files(self):
        root = Path(os.environ["LOCALAPPDATA"]) / "Temp/.agents" if os.name == "nt" else Path("/tmp/.agents")
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as temp:
            files = [Path(temp) / "课件.pptx", Path(temp) / "讲义.docx"]
            for file in files:
                file.write_bytes(b"x" * 600)
            config = {"sender": "s@example.com", "recipients": ["r@example.com"]}
            messages = module.build_messages(files, "test", "body", config, 1000)
            self.assertEqual(len(messages), 2)
            self.assertEqual([p.get_filename() for m in messages for p in m.iter_attachments()], [f.name for f in files])
            self.assertRaises(ValueError, module.plan_messages, files, 500)


if __name__ == "__main__":
    unittest.main()
