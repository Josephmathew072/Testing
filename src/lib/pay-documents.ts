import { PDFDocument, PDFFont, PDFPage, RGB, StandardFonts, rgb } from "pdf-lib";

export type PayLineItem = { name: string; amount: number };

export type SalaryVersion = {
  /** Display label such as "V1". Defaults to V{index + 1}. */
  label?: string | null;
  effectiveFrom: string;
  /** ISO date, or null when the version is still open. */
  effectiveTo: string | null;
  /** Monthly salary / contract rate for this version. */
  monthlyAmount: number;
};

export type PayDocumentInput = {
  companyName: string;
  registeredAddress?: string;
  payslipTitle?: string;
  contractorStatementTitle?: string;
  footerText?: string;
  authorisedSignatory?: string;
  showAttendance?: boolean;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  documentNumber: string;
  workerType: "employee" | "contractor";
  workerCode: string | null;
  workerName: string;
  locationName: string | null;
  departmentName: string | null;
  designationName: string | null;
  paymentBasis: string | null;
  expectedDays: number;
  presentDays: number;
  /** Paid leave days, including any WFH days (wfhDays is shown separately). */
  paidLeaveDays: number;
  absenceDays: number;
  halfDays: number;
  payableDays?: number;
  weekoffDays?: number;
  wfhDays?: number;
  grossPay: number;
  statutoryDeductions: number;
  attendanceDeductions: number;
  otherDeductions: number;
  employerContributions: number;
  netPay: number;
  earnings: PayLineItem[];
  deductions: PayLineItem[];
  employerItems?: PayLineItem[];
  publishedAt: string;
  dateOfJoining?: string | null;
  bankDetails?: string | null;
  panNumber?: string | null;
  pfUan?: string | null;
  pfAccountNo?: string | null;
  esiNo?: string | null;
  /** "old" (shown as "Regular Tax Regime") or "new" ("New Tax Regime"). Row is hidden when unset. */
  taxRegime?: string | null;
  /** PR Account Number (NPS). Row is hidden when unset — most workers will not have one. */
  pran?: string | null;
  /**
   * Legacy pre-formatted versions string ("V1 2026-08-05 → 2026-09-23 @ 22,000; V2 ...").
   * Parsed into `salaryVersions` when possible. Prefer passing `salaryVersions` directly.
   */
  salaryVersionsLabel?: string | null;
  /** Salary versions that applied during the period. Only shown when the salary changed mid-period. */
  salaryVersions?: SalaryVersion[] | null;
  /** PNG bytes for the letterhead logo (top-right). Falls back to a text wordmark when omitted. */
  logoPng?: Uint8Array | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const COLORS = {
  ink: rgb(0.1, 0.11, 0.14),
  muted: rgb(0.4, 0.43, 0.48),
  border: rgb(0.62, 0.65, 0.7),
  headFill: rgb(0.94, 0.95, 0.96),
  brand: rgb(0.95, 0.45, 0.08),
  brandSoft: rgb(1, 0.95, 0.9),
  logoGrey: rgb(0.36, 0.38, 0.42)
};

function taxRegimeLabel(value: string | null | undefined) {
  if (value === "old") return "Regular Tax Regime";
  if (value === "new") return "New Tax Regime";
  return null;
}

function amount(value: number) {
  return Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function days(value: number | undefined) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function inrWords(value: number) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const chunk = (n: number): string => {
    if (n < 20) return ones[n];
    if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ""}`;
    return `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${chunk(n % 100)}` : ""}`;
  };
  const words = (n: number): string => {
    const crore = Math.floor(n / 1e7);
    const lakh = Math.floor((n % 1e7) / 1e5);
    const thousand = Math.floor((n % 1e5) / 1e3);
    const hundred = n % 1000;
    return [
      crore ? `${words(crore)} Crore` : "",
      lakh ? `${chunk(lakh)} Lakh` : "",
      thousand ? `${chunk(thousand)} Thousand` : "",
      hundred ? chunk(hundred) : ""
    ].filter(Boolean).join(" ");
  };
  const totalPaise = Math.round(Math.abs(Number(value || 0)) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  if (!rupees && !paise) return "INR Zero Only";
  const rupeeText = rupees ? words(rupees) : "Zero";
  return `INR ${rupeeText}${paise ? ` and ${chunk(paise)} Paise` : ""} Only`;
}

/** Standard PDF fonts only cover WinAnsi; map the common Unicode punctuation instead of silently dropping it. */
function safe(text: string | null | undefined) {
  return String(text ?? "")
    .replace(/[→⇒➝]/g, " to ")
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₹/g, "INR ")
    .replace(/[·•]/g, "|")
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number) {
  const value = safe(text);
  if (!value) return "";
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let clipped = value;
  while (clipped.length > 1 && font.widthOfTextAtSize(`${clipped}...`, size) > maxWidth) clipped = clipped.slice(0, -1);
  return `${clipped.trimEnd()}...`;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ").filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${Number(match[3])}-${MONTHS[Number(match[2]) - 1]}-${match[1]}`;
}

/** Parses the legacy "V1 2026-08-05 → 2026-09-23 @ 22,000; V2 2026-09-24 → open @ 24,500" label. */
export function parseSalaryVersionsLabel(label: string | null | undefined): SalaryVersion[] {
  const versions: SalaryVersion[] = [];
  const pattern = /(V\d+)\s*(\d{4}-\d{2}-\d{2})\D*?(\d{4}-\d{2}-\d{2}|open)\s*@\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)/gi;
  for (const match of String(label || "").matchAll(pattern)) {
    versions.push({
      label: match[1].toUpperCase(),
      effectiveFrom: match[2],
      effectiveTo: match[3].toLowerCase() === "open" ? null : match[3],
      monthlyAmount: Number(match[4].replace(/,/g, ""))
    });
  }
  return versions;
}

/** Collapses rows that would not fit into a single "Other ..." row so totals stay correct on one page. */
function capRows(items: PayLineItem[], max: number, otherLabel: string) {
  if (items.length <= max) return items;
  const kept = items.slice(0, max - 1);
  const rest = items.slice(max - 1);
  return [...kept, { name: `${otherLabel} (${rest.length} items)`, amount: rest.reduce((sum, item) => sum + Number(item.amount || 0), 0) }];
}

type Align = "left" | "right" | "center";

class Canvas {
  constructor(
    readonly page: PDFPage,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly italic: PDFFont
  ) {}

  text(value: string, x: number, y: number, opts: { size?: number; font?: PDFFont; color?: RGB; align?: Align; maxWidth?: number } = {}) {
    const size = opts.size ?? 8.5;
    const font = opts.font ?? this.regular;
    const content = opts.maxWidth ? fit(value, font, size, opts.maxWidth) : safe(value);
    if (!content) return;
    const width = font.widthOfTextAtSize(content, size);
    const drawX = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.page.drawText(content, { x: drawX, y, size, font, color: opts.color ?? COLORS.ink });
  }

  /** Text vertically centred inside a cell whose top edge is `top`. */
  cell(value: string, x: number, top: number, width: number, height: number, opts: { size?: number; font?: PDFFont; color?: RGB; align?: Align } = {}) {
    const size = opts.size ?? 8.5;
    const pad = 5;
    const baseline = top - height / 2 - size * 0.35;
    const anchor = opts.align === "right" ? x + width - pad : opts.align === "center" ? x + width / 2 : x + pad;
    this.text(value, anchor, baseline, { ...opts, size, maxWidth: width - pad * 2 });
  }

  rect(x: number, top: number, width: number, height: number, opts: { fill?: RGB; border?: RGB; borderWidth?: number } = {}) {
    this.page.drawRectangle({
      x,
      y: top - height,
      width,
      height,
      color: opts.fill,
      borderColor: opts.border,
      borderWidth: opts.border ? opts.borderWidth ?? 0.6 : 0
    });
  }

  hline(x1: number, x2: number, y: number, color: RGB = COLORS.border, thickness = 0.6) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }

  vline(x: number, top: number, bottom: number, color: RGB = COLORS.border, thickness = 0.6) {
    this.page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness, color });
  }
}

/** DropX letterhead payslip / contractor payment statement in a bordered, Tally-style layout. */
export async function createPayDocumentPdf(input: PayDocumentInput) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const c = new Canvas(page, regular, bold, italic);
  const margin = 36;
  const right = width - margin;
  const contentWidth = right - margin;
  const isEmployee = input.workerType === "employee";
  const company = safe(input.companyName) || "DROPX LOGISTICS";

  const title = safe(isEmployee ? input.payslipTitle || "Payslip" : input.contractorStatementTitle || "Payment Statement");
  pdf.setTitle(`${title} - ${safe(input.workerName)} - ${safe(input.periodLabel)}`);
  pdf.setAuthor(company);
  pdf.setSubject(safe(input.documentNumber));
  pdf.setCreator(company);

  // ── Letterhead ──────────────────────────────────────────────────────────
  let y = height - 48;
  const logoHeight = 34;
  let logoDrawn = false;
  if (input.logoPng?.length) {
    try {
      const logo = await pdf.embedPng(input.logoPng);
      const logoWidth = Math.min((logo.width / logo.height) * logoHeight, 150);
      const drawHeight = (logo.height / logo.width) * logoWidth;
      page.drawImage(logo, { x: right - logoWidth, y: y + 14 - drawHeight, width: logoWidth, height: drawHeight });
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) {
    const markSize = 20;
    const xWidth = bold.widthOfTextAtSize("X", markSize);
    const dropWidth = bold.widthOfTextAtSize("Drop", markSize);
    page.drawText("Drop", { x: right - xWidth - dropWidth, y: y - 6, size: markSize, font: bold, color: COLORS.logoGrey });
    page.drawText("X", { x: right - xWidth, y: y - 6, size: markSize, font: bold, color: COLORS.brand });
  }

  c.text(company.toUpperCase(), margin, y, { size: 14, font: bold, maxWidth: 330 });
  y -= 13;
  // Split before sanitising — safe() collapses newlines, which used to glue address lines together.
  const addressLines = String(input.registeredAddress || "")
    .split(/\r?\n/)
    .flatMap((part) => wrap(safe(part), regular, 8.5, 330))
    .slice(0, 4);
  for (const lineText of addressLines) {
    c.text(lineText, margin, y, { size: 8.5, color: COLORS.muted, maxWidth: 330 });
    y -= 11;
  }
  y = Math.min(y, height - 48 - logoHeight) - 4;
  c.hline(margin, right, y, COLORS.brand, 1.6);

  // ── Title ───────────────────────────────────────────────────────────────
  y -= 22;
  c.text(title, width / 2, y, { size: 15, font: bold, align: "center" });
  y -= 14;
  c.text(`for the month of ${input.periodLabel}`, width / 2, y, { size: 9, font: bold, color: COLORS.ink, align: "center" });
  y -= 12;
  c.text(`${formatDate(input.periodStart)} to ${formatDate(input.periodEnd)}`, width / 2, y, { size: 8.5, color: COLORS.muted, align: "center" });
  y -= 14;

  // ── Worker details ──────────────────────────────────────────────────────
  const rowH = 15;
  const half = contentWidth / 2;
  const nameBarH = 20;
  const leftPairs: Array<[string, string]> = [
    [isEmployee ? "Employee Number" : "Contractor ID", input.workerCode || "-"],
    ["Function", input.departmentName || "-"],
    ["Designation", input.designationName || "-"],
    ["Location", input.locationName || "-"],
    ["Bank Details", input.bankDetails || "-"],
    ["Date of Joining", formatDate(input.dateOfJoining) || "-"]
  ];
  // Optional statutory fields (Tax Regime, PRAN) are hidden rather than shown as blank placeholders.
  // Contractors are not covered by PF/ESI, so those rows only appear for them when a value exists.
  const statutoryRow = (label: string, value: string | null | undefined): Array<[string, string]> =>
    isEmployee || value?.trim() ? [[label, value?.trim() || "-"]] : [];
  const regime = taxRegimeLabel(input.taxRegime);
  const rightPairs: Array<[string, string]> = [
    ...(regime ? [["Tax Regime", regime] as [string, string]] : []),
    ["Income Tax Number (PAN)", input.panNumber || "-"],
    ...statutoryRow("Universal Account No. (UAN)", input.pfUan),
    ...statutoryRow("PF Account Number", input.pfAccountNo),
    ...statutoryRow("ESI Number", input.esiNo),
    ...(input.pran?.trim() ? [["PR Account Number (PRAN)", input.pran.trim()] as [string, string]] : [])
  ];
  const detailRows = Math.max(leftPairs.length, rightPairs.length);
  const detailsH = nameBarH + detailRows * rowH + 6;
  c.rect(margin, y, contentWidth, detailsH, { border: COLORS.border });
  c.rect(margin, y, contentWidth, nameBarH, { fill: COLORS.headFill });
  c.hline(margin, right, y - nameBarH);
  c.cell(input.workerName, margin, y, contentWidth, nameBarH, { size: 11, font: bold });
  c.cell(isEmployee ? "Employee" : "Contractor", margin, y, contentWidth, nameBarH, { size: 8, color: COLORS.muted, align: "right" });
  c.vline(margin + half, y - nameBarH, y - detailsH);
  const drawPair = ([label, value]: [string, string], x: number, top: number, labelW: number) => {
    c.cell(label, x, top, labelW, rowH, { size: 8, color: COLORS.muted });
    c.text(":", x + labelW, top - rowH / 2 - 2.8, { size: 8, color: COLORS.muted });
    c.cell(value, x + labelW + 2, top, half - labelW - 2, rowH, { size: 8.5 });
  };
  let rowTop = y - nameBarH - 3;
  for (let i = 0; i < detailRows; i += 1) {
    if (leftPairs[i]) drawPair(leftPairs[i], margin, rowTop, 92);
    if (rightPairs[i]) drawPair(rightPairs[i], margin + half, rowTop, 122);
    rowTop -= rowH;
  }
  y -= detailsH + 10;

  // ── Attendance summary ─────────────────────────────────────────────────
  if (input.showAttendance !== false) {
    const wfh = Number(input.wfhDays || 0);
    const weekoff = Number(input.weekoffDays || 0);
    const payable = input.payableDays ?? input.presentDays + input.halfDays * 0.5 + input.paidLeaveDays + weekoff;
    const cols: Array<[string, string]> = [
      ["Working Days", days(input.expectedDays)],
      ["Present", days(input.presentDays)],
      ["Half Days", days(input.halfDays)],
      ["Paid Leave", days(Math.max(0, input.paidLeaveDays - wfh))],
      ["WFH", days(wfh)],
      ["Week Off", days(weekoff)],
      ["Absent / LOP", days(input.absenceDays)],
      ["Paid Days", days(payable)]
    ];
    const headH = 14;
    const valH = 18;
    const colW = contentWidth / cols.length;
    c.text("ATTENDANCE SUMMARY", margin, y - 8, { size: 7.5, font: bold, color: COLORS.muted });
    y -= 13;
    c.rect(margin, y, contentWidth, headH, { fill: COLORS.headFill });
    // Highlight the column that actually drives pay.
    c.rect(margin + colW * (cols.length - 1), y, colW, headH + valH, { fill: COLORS.brandSoft });
    c.rect(margin, y, contentWidth, headH + valH, { border: COLORS.border });
    c.hline(margin, right, y - headH);
    cols.forEach(([label, value], index) => {
      const x = margin + colW * index;
      if (index) c.vline(x, y, y - headH - valH);
      const isPaid = index === cols.length - 1;
      c.cell(label, x, y, colW, headH, { size: 7.5, font: bold, color: isPaid ? COLORS.ink : COLORS.muted, align: "center" });
      c.cell(value, x, y - headH, colW, valH, { size: 10, font: isPaid ? bold : regular, align: "center" });
    });
    y -= headH + valH + 10;
  }

  // ── Salary revisions (only when pay changed mid-period) ────────────────
  const versions = input.salaryVersions?.length ? input.salaryVersions : parseSalaryVersionsLabel(input.salaryVersionsLabel);
  if (versions.length > 1) {
    const shown = versions.slice(0, 4);
    const headH = 14;
    const verRowH = 14;
    const widths = [60, 230, contentWidth - 290];
    const xs = [margin, margin + widths[0], margin + widths[0] + widths[1]];
    c.text("SALARY REVISED DURING THIS PERIOD - EARNINGS ARE PRO-RATED", margin, y - 8, { size: 7.5, font: bold, color: COLORS.muted });
    y -= 13;
    const tableH = headH + shown.length * verRowH;
    c.rect(margin, y, contentWidth, headH, { fill: COLORS.headFill });
    c.rect(margin, y, contentWidth, tableH, { border: COLORS.border });
    c.hline(margin, right, y - headH);
    ["Version", "Effective Period", isEmployee ? "Monthly Salary (INR)" : "Monthly Rate (INR)"].forEach((label, i) => {
      c.cell(label, xs[i], y, widths[i], headH, { size: 7.5, font: bold, color: COLORS.muted, align: i === 2 ? "right" : "left" });
    });
    xs.slice(1).forEach((x) => c.vline(x, y, y - tableH));
    let vTop = y - headH;
    shown.forEach((version, index) => {
      const period = `${formatDate(version.effectiveFrom)} to ${version.effectiveTo ? formatDate(version.effectiveTo) : "present"}`;
      c.cell(version.label || `V${index + 1}`, xs[0], vTop, widths[0], verRowH, { size: 8.5 });
      c.cell(period, xs[1], vTop, widths[1], verRowH, { size: 8.5 });
      c.cell(amount(version.monthlyAmount), xs[2], vTop, widths[2], verRowH, { size: 8.5, align: "right" });
      vTop -= verRowH;
    });
    y -= tableH + 10;
  } else if (!versions.length && input.salaryVersionsLabel?.trim()) {
    // Unrecognised free-text label: show it as a quiet note instead of dropping it.
    c.text(`Note: ${input.salaryVersionsLabel}`, margin, y - 8, { size: 7.5, font: italic, color: COLORS.muted, maxWidth: contentWidth });
    y -= 16;
  }

  // ── Earnings & deductions ──────────────────────────────────────────────
  const earnings = input.earnings.length ? input.earnings : [{ name: "Gross Pay", amount: input.grossPay }];
  const deductions = input.deductions.length
    ? input.deductions
    : [
        ...(input.statutoryDeductions ? [{ name: "Statutory Deductions", amount: input.statutoryDeductions }] : []),
        ...(input.attendanceDeductions ? [{ name: "Attendance Deduction", amount: input.attendanceDeductions }] : []),
        ...(input.otherDeductions ? [{ name: "Other Deductions", amount: input.otherDeductions }] : [])
      ];
  const employerItems = input.employerItems?.length
    ? input.employerItems
    : input.employerContributions
      ? [{ name: "Employer Contribution", amount: input.employerContributions }]
      : [];

  // Everything below the line items needs roughly this much room above the footer.
  const reserved = 52 + 30 + (employerItems.length ? 14 * (employerItems.length + 2) + 12 : 0) + 70;
  const lineH = 15;
  const maxLines = Math.max(4, Math.floor((y - reserved - lineH * 2) / lineH));
  const earningRows = capRows(earnings, maxLines, "Other Earnings");
  const deductionRows = capRows(deductions, maxLines, "Other Deductions");
  const lines = Math.max(earningRows.length, deductionRows.length, 1);
  const totalEarnings = earningRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalDeductions = deductionRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const amtW = 88;
  const nameW = half - amtW;
  const colX = [margin, margin + nameW, margin + half, margin + half + nameW];
  const tableH = lineH * (lines + 2);
  c.rect(margin, y, contentWidth, lineH, { fill: COLORS.headFill });
  c.rect(margin, y - lineH * (lines + 1), contentWidth, lineH, { fill: COLORS.headFill });
  c.rect(margin, y, contentWidth, tableH, { border: COLORS.border });
  c.hline(margin, right, y - lineH);
  c.hline(margin, right, y - lineH * (lines + 1));
  colX.slice(1).forEach((x) => c.vline(x, y, y - tableH, COLORS.border, x === margin + half ? 0.9 : 0.6));
  const head = ["Earnings", "Amount (INR)", "Deductions", "Amount (INR)"];
  head.forEach((label, i) => {
    const w = i % 2 ? amtW : nameW;
    c.cell(label, colX[i], y, w, lineH, { size: 8.5, font: bold, align: i % 2 ? "right" : "left" });
  });
  let lineTop = y - lineH;
  for (let i = 0; i < lines; i += 1) {
    const e = earningRows[i];
    const d = deductionRows[i];
    if (e) {
      c.cell(e.name, colX[0], lineTop, nameW, lineH);
      c.cell(amount(e.amount), colX[1], lineTop, amtW, lineH, { align: "right" });
    }
    if (d) {
      c.cell(d.name, colX[2], lineTop, nameW, lineH);
      c.cell(amount(d.amount), colX[3], lineTop, amtW, lineH, { align: "right" });
    }
    lineTop -= lineH;
  }
  c.cell("Total Earnings", colX[0], lineTop, nameW, lineH, { font: bold });
  c.cell(amount(totalEarnings), colX[1], lineTop, amtW, lineH, { font: bold, align: "right" });
  c.cell("Total Deductions", colX[2], lineTop, nameW, lineH, { font: bold });
  c.cell(amount(totalDeductions), colX[3], lineTop, amtW, lineH, { font: bold, align: "right" });
  y -= tableH;

  // ── Net pay band ───────────────────────────────────────────────────────
  const netH = 40;
  y -= 8;
  c.rect(margin, y, contentWidth, netH, { fill: COLORS.brandSoft, border: COLORS.brand, borderWidth: 0.9 });
  c.text(isEmployee ? "NET PAY (Take Home)" : "NET PAYABLE", margin + 10, y - 16, { size: 10, font: bold });
  c.text(`INR ${amount(input.netPay)}`, right - 10, y - 17, { size: 13, font: bold, align: "right" });
  c.text(`Amount in words: ${inrWords(input.netPay)}`, margin + 10, y - 31, { size: 8, font: italic, color: COLORS.muted, maxWidth: contentWidth - 20 });
  y -= netH + 14;

  // ── Employer contribution + signatory ──────────────────────────────────
  const signTop = y;
  if (employerItems.length) {
    const ecH = 14;
    const ecW = half - 12;
    const ecAmtW = amtW;
    const ecTableH = ecH * (employerItems.length + 2);
    c.rect(margin, y, ecW, ecH, { fill: COLORS.headFill });
    c.rect(margin, y - ecH * (employerItems.length + 1), ecW, ecH, { fill: COLORS.headFill });
    c.rect(margin, y, ecW, ecTableH, { border: COLORS.border });
    c.hline(margin, margin + ecW, y - ecH);
    c.hline(margin, margin + ecW, y - ecH * (employerItems.length + 1));
    c.vline(margin + ecW - ecAmtW, y, y - ecTableH);
    c.cell("Employer Contribution", margin, y, ecW - ecAmtW, ecH, { size: 8.5, font: bold });
    c.cell("Amount (INR)", margin + ecW - ecAmtW, y, ecAmtW, ecH, { size: 8.5, font: bold, align: "right" });
    let ecTop = y - ecH;
    for (const item of employerItems) {
      c.cell(item.name, margin, ecTop, ecW - ecAmtW, ecH);
      c.cell(amount(item.amount), margin + ecW - ecAmtW, ecTop, ecAmtW, ecH, { align: "right" });
      ecTop -= ecH;
    }
    c.cell("Total", margin, ecTop, ecW - ecAmtW, ecH, { font: bold });
    c.cell(amount(employerItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)), margin + ecW - ecAmtW, ecTop, ecAmtW, ecH, { font: bold, align: "right" });
    c.text("Employer contributions are not part of take-home pay.", margin, y - ecTableH - 10, { size: 7, font: italic, color: COLORS.muted });
  }
  c.text(`for ${company.toUpperCase()}`, right, signTop - 10, { size: 9, font: bold, align: "right", maxWidth: half - 12 });
  c.hline(right - 140, right, signTop - 46, COLORS.border, 0.5);
  c.text(input.authorisedSignatory || "Authorised Signatory", right, signTop - 58, { size: 8.5, align: "right", maxWidth: half - 12 });

  // ── Footer ─────────────────────────────────────────────────────────────
  const footerY = 30;
  c.hline(margin, right, footerY + 12, COLORS.border, 0.5);
  const footerText = input.footerText || "This is a system-generated document from the locked payroll snapshot and does not require a signature.";
  wrap(safe(footerText), regular, 7, contentWidth - 205)
    .slice(0, 2)
    .forEach((lineText, index) => c.text(lineText, margin, footerY - index * 9, { size: 7, color: COLORS.muted }));
  const meta = [input.documentNumber ? `Doc No: ${input.documentNumber}` : "", input.publishedAt ? `Generated: ${formatDate(input.publishedAt)}` : ""]
    .filter(Boolean)
    .join("  |  ");
  c.text(meta, right, footerY, { size: 7, color: COLORS.muted, align: "right", maxWidth: 195 });

  return pdf.save();
}
