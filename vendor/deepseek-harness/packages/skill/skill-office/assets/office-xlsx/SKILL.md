---
name: office-xlsx
description: Read, create, and modify Excel workbooks (.xlsx), including cell values, formulas, formatting, and pandas analysis. Use when an Excel workbook is an input or deliverable.
---

# Excel workbooks

Follow an explicit user or applicable AGENTS.md requirement for an environment or library. Otherwise call `load_workspace_dependencies` and run its Python executable with bundled `openpyxl` and `pandas`. Do not install packages or search for a system Python for the default workflow. If the tool is unavailable, use an already configured environment and report a missing dependency only when it prevents the requested operation.

Keep scripts, working files, and outputs in the task workspace. The runtime and skill directory are shared read-only resources. Save to a new workbook unless the user requests an in-place edit.

## Read and modify

Use `openpyxl` for existing XLSX workbooks and targeted cell or style changes. Load with `data_only=False` when formulas must survive. Inspect sheet names, the affected cell types, formulas, styles, merged ranges, and referenced ranges before editing. Check the saved file by reopening it, including unchanged content that the request requires preserving.

Use pandas for data analysis and transformations. A DataFrame is not the workbook: exporting it over an existing file can lose sheets, formulas, charts, and formatting. Write analysis results back to the intended ranges with openpyxl. `XlsxWriter` can create new workbooks, but cannot read or modify existing ones.

For a new workbook, the selected Python environment can write editable values, styles, and formulas directly:

```python
from openpyxl import Workbook
from openpyxl.styles import Font

workbook = Workbook()
sheet = workbook.active
sheet.title = "Revenue"
for row in [("Quarter", "Revenue"), ("Q1", 12), ("Q2", 18), ("Total", "=SUM(B2:B3)")]:
    sheet.append(row)
for cell in sheet[1]:
    cell.font = Font(bold=True)
sheet.column_dimensions["A"].width = 18
sheet.column_dimensions["B"].width = 18
workbook.save("report.xlsx")
```

Preserve numbers, dates, booleans, and identifiers as the intended cell types; formatting is not a type conversion. For modifications, load the existing file with `openpyxl.load_workbook("input.xlsx", data_only=False)`, change the requested ranges, and save a separate result. Avoid a DataFrame round trip when workbook features must survive.

Writing a formula does not calculate its result. openpyxl and XlsxWriter do not evaluate Excel formulas; `data_only=True` returns stored cached values that may be absent or stale. Verify formulas and inputs separately, and state when current results require recalculation in a spreadsheet application. Do not replace requested formulas with constants or report cached values as newly calculated results.

Do not rename `.xls`, `.xlsb`, encrypted files, or macro-enabled files to `.xlsx`. They need an appropriate supported operation. `keep_vba=True` can preserve VBA package content in an XLSM workflow, but does not execute or edit macros and does not guarantee every advanced workbook feature survives. Preserve the original and verify such requirements explicitly.

## Check and deliver

Run the shared checker with the selected Python executable; `<skill-directory>` is this loaded skill's resource base:

```text
<python> <skill-directory>/../scripts/check_office.py <workbook.xlsx> --out <checks.json>
```

It checks ZIP/XML integrity and internal relationships, and reports sheet names, populated-cell counts, and formula counts. Repeated `--contains TEXT` arguments check string cells and sheet names, and `--count N` checks sheet count. `--contains` excludes numeric cells and does not validate formula results; verify those separately with openpyxl. The checker does not calculate formulas or judge workbook appearance. Compare relevant values, types, formulas, styles, and totals with the task's source data.

If `render_document` is available and visual inspection is useful, call it on the final workbook without `pages` to prepare page 1 and learn `pageCount`. It checks the current main model's actual image capability; do not choose a second model. On `status: "skipped"`, complete structural and data checks and deliver the workbook, briefly stating that visual layout was not inspected. Otherwise call `read_image` on `pages[].imagePath` and request remaining pages in small batches. Check column widths, number formats, clipping, charts, and print areas; fix the workbook and review the affected pages again.

Rendered pages follow spreadsheet print settings, so a page is not necessarily a worksheet. Set appropriate print areas and scaling when a readable printed layout is requested. Review `warnings` such as missing fonts. LibreOffice preview conversion neither updates the original workbook's cached formulas nor certifies native Excel calculation or appearance. If rendering is unavailable or fails, preserve the usable workbook and report the inspection limit; ordinary cell edits do not require installing an external renderer.

Call `present({"files":[{"path":"report.xlsx"}]})` with the actual final workbook path. It exposes the current source file without copying or preserving its bytes, so keep that file in place and omit intermediate scripts and reports unless requested. If `present` is unavailable, use the session's supported file delivery method.
