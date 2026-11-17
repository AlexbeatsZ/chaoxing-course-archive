"""Portable Word exporter. Uses platform text only; no speech or language model."""
import json
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Mm, Pt, RGBColor


def timestamp(value):
    whole = int(value)
    return f"{whole // 3600:02d}:{whole // 60 % 60:02d}:{whole % 60:02d}"


def font_style(style, size, bold=False):
    style.font.name = "Arial"
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.color.rgb = RGBColor(0, 0, 0)
    fonts = style.element.get_or_add_rPr().get_or_add_rFonts()
    fonts.set(qn("w:eastAsia"), "宋体")
    fonts.set(qn("w:ascii"), "Arial")
    fonts.set(qn("w:hAnsi"), "Arial")


def add_run_font(run):
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), "宋体")


def chunks(segments, limit=360):
    current, count = [], 0
    for segment in segments:
        if current and count + len(segment["text"]) > limit:
            yield current
            current, count = [], 0
        current.append(segment)
        count += len(segment["text"])
    if current:
        yield current


def build(directory, target):
    directory, target = Path(directory), Path(target)
    data = json.loads((directory / "lesson.json").read_text(encoding="utf-8"))
    transcript = {s["id"]: s for s in data["transcript"]}
    assigned = [s for o in data["occurrences"] for s in o["transcriptIds"]]
    if len(assigned) != len(transcript) or set(assigned) != set(transcript):
        raise ValueError("Transcript must be included exactly once")
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Mm(210), Mm(297)
    section.top_margin, section.bottom_margin = Mm(17), Mm(17)
    section.left_margin, section.right_margin = Mm(19), Mm(19)
    font_style(doc.styles["Normal"], 10.5)
    doc.styles["Normal"].paragraph_format.line_spacing = 1.35
    doc.styles["Normal"].paragraph_format.space_after = Pt(5)
    for name, size in [("Title", 22), ("Heading 1", 15), ("Heading 2", 11)]:
        font_style(doc.styles[name], size, True)
    # python-docx's built-in template can carry a decorative Title border.
    # Keep the lecture heading plain across Word and LibreOffice.
    for style in doc.styles:
        for border in list(style.element.iter(qn("w:pBdr"))):
            border.getparent().remove(border)
    doc.styles["Heading 1"].paragraph_format.space_before = Pt(14)
    doc.styles["Heading 1"].paragraph_format.space_after = Pt(6)
    doc.styles["Heading 1"].paragraph_format.keep_with_next = True
    title = data["metadata"]["course"] + " 课件与讲解"
    doc.add_paragraph(title, "Title")
    meta = data["metadata"]
    doc.add_paragraph(f"{meta.get('date', '')}  第 {meta.get('lesson', '')} 节  {meta.get('teacher', '')}")
    doc.add_paragraph(f"按课件页面归集对应时段的课堂讲解。共 {len(data['pages'])} 页课件，{len(transcript)} 段讲解。")
    for page in data["pages"]:
        doc.add_paragraph(page["title"], "Heading 1")
        paragraph = doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.keep_with_next = True
        ratio = page["width"] / page["height"]
        width = min(6.77, 3.45 * ratio)
        picture = paragraph.add_run().add_picture(str(directory / page["image"]), width=Inches(width))
        picture._inline.docPr.set("descr", page["title"])
        occurrences = [o for o in data["occurrences"] if o["slideId"] == page["id"]]
        if not any(o["transcriptIds"] for o in occurrences):
            doc.add_paragraph("该画面对应时段平台未提供讲解文字。")
        for occurrence in occurrences:
            if not occurrence["transcriptIds"]:
                continue
            doc.add_paragraph(f"讲解时段 {timestamp(occurrence['start'])} 至 {timestamp(occurrence['end'])}", "Heading 2")
            selected = [transcript[i] for i in occurrence["transcriptIds"]]
            for group in chunks(selected):
                p = doc.add_paragraph()
                marker = p.add_run(f"[{timestamp(group[0]['start'])}] ")
                marker.font.size = Pt(9)
                marker.font.color.rgb = RGBColor(95, 95, 95)
                add_run_font(marker)
                run = p.add_run("".join(s["text"] for s in group))
                add_run_font(run)
    doc.core_properties.title = title
    doc.core_properties.author = ""
    doc.core_properties.last_modified_by = ""
    target.parent.mkdir(parents=True, exist_ok=True)
    doc.save(target)
    print(json.dumps({"file": str(target), "pages": len(data["pages"]), "segments": len(transcript)}, ensure_ascii=False))


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
