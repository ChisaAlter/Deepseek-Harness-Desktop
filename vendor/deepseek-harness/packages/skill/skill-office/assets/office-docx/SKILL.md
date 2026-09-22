---
name: office-docx
description: Create, read, edit, and check Word documents (.docx), including reports, letters, and formatted tables. Use when a DOCX file is an input or requested deliverable.
---

# Word documents

Use `python-docx` for DOCX creation and ordinary edits. Follow an explicit user or applicable AGENTS.md requirement for a project environment or another library. Otherwise call `load_workspace_dependencies` and execute the returned Python path with its bundled libraries. Do not install packages or discover a system Python for the default workflow. If the tool is unavailable, use an already configured environment and report a missing dependency only when it prevents the requested operation.

Keep source scripts, intermediate files, and final documents in the task workspace; the runtime and this skill directory are read-only resources. Use the user's requested language and preserve an existing document's design unless a redesign is requested.

## Create and edit

For existing files, inspect paragraphs, runs, tables, sections, headers, and footers before changing the affected content. Save to a new file unless the user requests an in-place edit. Replacing a paragraph's `.text` destroys its run formatting; change the relevant runs when formatting must survive. Reconstructing the whole document can lose features outside python-docx's supported editing API.

Use paragraph styles for headings and body text. Size tables for the section that contains them, and account for merged cells and nested tables. Chinese, Japanese, and Korean text may need an explicit `w:eastAsia` font assignment in addition to `run.font.name`; font names alone do not establish glyph availability or rendered appearance.

For a new document, use the selected Python executable:

```python
from docx import Document

document = Document()
document.add_heading("Project report", level=0)
document.add_paragraph("Summary", style="Heading 1")
document.add_paragraph("The requested findings go here.")
document.save("report.docx")
```

python-docx does not paginate or render documents. Do not represent ordinary replacement, colored text, or comments as tracked changes. When real revisions or unsupported OOXML features matter, preserve their package parts and verify the requested operation rather than silently discarding them.

## Check and deliver

Run the shared checker with the selected Python executable; `<skill-directory>` is this loaded skill's resource base:

```text
<python> <skill-directory>/../scripts/check_office.py <document.docx> --out <checks.json>
```

It checks ZIP/XML integrity and internal relationships, and reports paragraphs, logical table dimensions, and sections. Optional `--contains TEXT` arguments assert required text. A successful structural check does not verify pagination, clipping, fonts, or visual appearance. Compare the summary and reopened document with the user's request, including unchanged content that matters to an edit.

If `render_document` is available and visual inspection is useful, call it on the final DOCX without `pages` to prepare page 1 and learn `pageCount`. It checks the current main model's actual image capability; do not choose a second model. On `status: "skipped"`, complete structural and content checks and deliver the document, briefly stating that visual layout was not inspected. On a ready result, call `read_image` on `pages[].imagePath` and request remaining pages in small batches. Check page breaks, clipped text, headings, table widths, and consistency with the requested format or source design. Fix the source and render affected pages again.

Use the available rendering tool for this check. Review `warnings` such as missing fonts. LibreOffice pagination can differ from Microsoft Word. If rendering is unavailable or fails, preserve the usable document and report the inspection limit; do not require the user to install a renderer.

Call `present({"files":[{"path":"report.docx"}]})` with the actual final DOCX path. It exposes the current source file without copying or preserving its bytes, so keep that file in place and do not present temporary QA reports unless requested. If `present` is unavailable, provide the final workspace path using the session's supported file delivery method.
