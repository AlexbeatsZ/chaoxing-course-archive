import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { saveJson } from './platform.mjs';

export function timecode(seconds, separator = '.') {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':') + separator + String(ms % 1000).padStart(3, '0');
}

export function subtitleText(transcript, format) {
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + transcript.map((s, i) => {
    const separator = format === 'srt' ? ',' : '.';
    // SRT players need a nonempty cue interval even when platform timestamps round equal.
    const end = Math.max(s.end, s.start + 0.001);
    return `${i + 1}\n${timecode(s.start, separator)} --> ${timecode(end, separator)}\n${s.text.replace(/\r/g, '').replace(/\n{2,}/g, '\n')}\n`;
  }).join('\n');
}

export async function writeTranscript(directory, transcript, metadata) {
  await saveJson(join(directory, 'transcript.json'), { schemaVersion: 1, metadata, segments: transcript });
  const title = `${metadata.course} · ${metadata.date} · 第 ${metadata.lesson} 节`;
  await Promise.all([
    writeFile(join(directory, 'transcript.srt'), subtitleText(transcript, 'srt')),
    writeFile(join(directory, 'transcript.vtt'), subtitleText(transcript, 'vtt')),
    writeFile(join(directory, 'transcript.md'), `# ${title}\n\n原平台自动转录，未经校订。时间为录屏播放时间。\n\n` + transcript.map(s =>
      `**${timecode(s.start)} – ${timecode(s.end)}**${s.speaker ? ` (${s.speaker})` : ''}\n\n${s.text}\n`).join('\n')),
    writeFile(join(directory, 'transcript.txt'), transcript.map(s => `[${timecode(s.start)} - ${timecode(s.end)}] ${s.text}`).join('\n') + '\n'),
  ]);
}

export function alignTranscript(occurrences, transcript) {
  const aligned = occurrences.map(o => ({ ...o, transcriptIds: [] }));
  if (!aligned.length && transcript.length) throw new Error('有字幕但没有可对应的课件页面。');
  for (const s of transcript) {
    let best = null, bestOverlap = -1, bestDistance = Infinity;
    for (const o of aligned) {
      const overlap = Math.max(0, Math.min(o.end, s.end) - Math.max(o.start, s.start));
      const distance = Math.max(o.start - s.end, s.start - o.end, 0);
      if (overlap > bestOverlap || (overlap === bestOverlap && distance < bestDistance)) {
        best = o; bestOverlap = overlap; bestDistance = distance;
      }
    }
    best.transcriptIds.push(s.id);
  }
  return aligned;
}
