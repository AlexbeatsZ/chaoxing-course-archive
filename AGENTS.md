# Goal
Build a Chaoxing 智播课堂 course archive: discover published replays, use platform transcripts with original timestamps, download the PPT video stream and automatically produce exactly two final files per lecture: PPTX and DOCX. Deliver public source on GitHub with Secrets/Actions and clear email setup, retaining the same ROG/local and optional QQ delivery capabilities. No speech or language model and no mandatory manual image selection.

# Current State
- Version 0.1.0-alpha.1, 2026-11-16 America/Los_Angeles. Node and uv project locks; existing FFmpeg/ffprobe on Mac. `local-data/` holds all private runtime material.
- Public source: `AlexbeatsZ/chaoxing-course-archive`, default `main`. The first GitHub Actions run passed on Ubuntu; releases include code only.
- Live platform: `fanyalubodata.fanya.chaoxing.com/starcloud`; replay player: `psp-zelda.chaoxing.com/vri-zelda`.
- Browser course listing requires login. Replay HTML exposes signed metadata; its read-only transcript API returns fractional second timestamps.
- Live sample: 50-minute, 1920x1080 PPT recording with 259 transcript segments. Platform PPT image API returns null, so extraction is needed. Automatic pipeline currently retains 55 distinct page images with all transcript segments assigned exactly once.
- Implemented automatic extraction/cropping/deduplication, Word/PPTX, credential login/discovery, SMTP test and attachment delivery, optional ROG OneBot private files, and encrypted durable GitHub delivery receipts. Mail names are compatible with personal iCourse Subscriber.
- Synthetic video smoke checks moving cursor, A-B-A revisits and actual Office file structure. Account/password cloud login, SMTP final delivery and physical ROG/QQ delivery require the user's actual configuration and remain unverified.
- Verified final sample slide images and all 39 Word render pages. The final pair embeds 55 images in each and matches all 259 transcript segments. Local preview of Chinese text required a task-private Fontconfig alias from 宋体 to Songti SC; the generated Word uses the standard 宋体 font name.
- Runtime source links, credentials, recordings, transcripts and generated artifacts belong in ignored `local-data/`. Never commit account details or signed URLs.

# Active Work
- Actual production account/SMTP/QQ verification remains pending configuration; do not use unrelated stored credentials.
- ROG deployment is available as code/documentation; no scheduled task has been installed on ROG.

# Build / Run / Test
- `npm ci`
- `npm test`
- `uv sync --locked`
- `uv run --locked python -m unittest discover -s test -p 'test_*.py' -v`
- `node test/smoke.mjs`
- `node src/run.mjs` (loads project `.env` or Secrets), `node src/run.mjs --mail-test`
- `node src/cli.mjs --help`
- Requires existing `ffmpeg` and `ffprobe` on PATH. Do not install global programs without user approval.

# Durable Lessons
- `video-slide-extractor` is a detector, not a complete deduplicator or document exporter. Preserve separate occurrences when a slide reappears.
- Do not select a video by array index: use the explicit `type=ppt` metadata. The teacher and student cameras are separate streams.
- API timestamps are more precise than displayed text. Preserve the original values and any playback offset.
- Sharp JPEG delivery assets require metadata (`withMetadata`) for python-docx to recognize the JPEG reliably. Preserve 4:4:4 chroma for screen text.
- Distinguish persistent state read/decryption failure from no state. SMTP acknowledgement and mailbox receipt are different acceptance points.

# Docs Index
- `docs/design/pipeline.md`: discovery, source selection, timestamp and extraction contracts.
- `docs/design/icourse-reuse.md`: source implementations and compatibility decisions.
- `docs/email-setup.md`: friend-facing Secrets/SMTP setup, testing and troubleshooting.
- `docs/rog.md`: local/ROG run and optional QQ delivery.
