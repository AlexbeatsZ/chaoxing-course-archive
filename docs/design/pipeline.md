# Local pipeline

## Source and session boundary
The user browses and logs in normally. Discovery saves a private catalog of courses or subscribed replays without exporting cookies or passwords. The internal lecture worker reads the signed replay URL from the subscription run’s private catalog, parses its JSON `args` declaration without evaluating JavaScript, and uses the same read-only endpoints as the player. Authentication failures remain explicit. A listing link is not itself a replay URL.

## Transcript
Preserve platform segments, speaker labels and fractional seconds. Produce JSON, SRT, VTT and Markdown. Raw timestamps and playback-relative timestamps are distinct. Edited videos and nonzero offsets must follow the player's existing timestamp adjustment behavior. Match transcript ranges to each slide occurrence by interval overlap, allowing one segment to overlap more than one occurrence.

## Recording
Choose `speech.videos[].type === 'ppt'` by default. Retain source metadata privately. Download via streaming HTTP into a `.part` file and resume only after validating HTTP range responses and total size. Never treat an HTML login/error document as a video. Probe streams after download. If PPT video has no audio, the transcript remains usable; an optional separate teacher stream can supply audio later.

## Slide extraction
Reuse the MIT `video-slide-extractor` detector for block-based differences and activity masks. Decode low-resolution analysis frames with FFmpeg. Preserve the source resolution on export. Require a stable dwell before accepting a page; select frames away from boundaries. Use temporal median capture to reduce moving cursors where supported by the observed frames. A cursor left stationary cannot be recovered with certainty.

Global duplicate matching is conservative and combines perceptual and pixel differences. Store unique images separately from timeline occurrences: revisiting slide A after slide B must keep the second A occurrence. Do not infer that similar slide layouts contain the same text. Keep ordinary animation states unless a configured short transition can be safely collapsed. Embedded video, scrolling and software demonstrations remain as images when uncertain; no manual filtering step is required.

## Output and review
Only two final files per lecture: a PPTX with one rendered page image per slide, and a DOCX with embedded images followed by the corresponding platform transcript. A repeated page appears once in the deck and groups all its lecture intervals in Word. Each source transcript segment is assigned exactly once using maximum interval overlap, with a nearest-page fallback for gaps. Original JSON/SRT/VTT/Markdown and candidate PNGs remain private intermediate files. JPEG delivery images use 4:4:4 chroma and JFIF/EXIF metadata for Office interoperability.

This reconstructs rendered pages, not the original editable PPT source. The local source recording, signed URLs and transcript content are never included in repository commits. Easy blanks, short transitions and high-confidence duplicates can be removed; ambiguous images stay. Automatic crop is limited to recognizable canvas ratios and falls back to the full image.

## Automation and delivery
The GitHub workflow takes account/password, source and SMTP settings from Secrets. An authenticated request context logs into the official Chaoxing endpoint and discovers published playable replays. For local runs, users can sign in with a browser profile. No speech, language or vision model is required.

Each successful email/QQ delivery channel is recorded independently. Persistent course selection lives in `data/subscriptions.json` on each user's own `data` branch; IDs are Chaoxing `courseinfoid` values. The discovery summary pairs each course name with its ID and links to the editor for the current Fork. All archive runs use the saved subscription IDs. Encrypted delivery receipts live beside the manifest at `data/delivery-state.enc`, using the existing `Salted__` envelope and optimistic Contents API updates. The old `archive-state/delivery-state.enc` is read as a migration source. Failures to read/decrypt existing state stop work rather than treating it as a first run. The Actions cache contains only an encrypted recovery copy. The workflow never uploads course files as public artifacts and removes signed links and request dumps from error output.

## Verification
Use a real replay and inspect rendered PPTX slides and Word pages. Validate the embedded image count and compare the Word text against the assigned platform segments. Synthetic fixtures cover a moving cursor, a short transition, a small text change, and A-B-A revisits.
