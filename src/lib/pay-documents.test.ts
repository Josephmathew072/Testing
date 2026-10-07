import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createPayDocumentPdf, inrWords, parseSalaryVersionsLabel } from "./pay-documents";

describe("pay documents", () => {
  it("creates a valid employee payslip PDF", async () => {
    const bytes = await createPayDocumentPdf({ companyName: "DropX Logistics", periodLabel: "August 2026", periodStart: "2026-08-01", periodEnd: "2026-08-31", documentNumber: "PAY-202608-D0888", workerType: "employee", workerCode: "D0888", workerName: "Test Employee", locationName: "HO_KL", departmentName: "Finance", designationName: "Executive", paymentBasis: "monthly_salary", expectedDays: 26, presentDays: 24, paidLeaveDays: 1, absenceDays: 1, halfDays: 0, grossPay: 30000, statutoryDeductions: 1800, attendanceDeductions: 1153.85, otherDeductions: 0, employerContributions: 1800, netPay: 27046.15, earnings: [{ name: "Basic", amount: 30000 }], deductions: [{ name: "PF", amount: 1800 }, { name: "Attendance deduction", amount: 1153.85 }], publishedAt: "2026-08-31T12:00:00Z" });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("creates a branded contractor statement without attendance", async () => {
    const bytes = await createPayDocumentPdf({ companyName: "DropX Logistics", registeredAddress: "Kochi, Kerala", contractorStatementTitle: "IC Payment Advice", footerText: "Generated from the locked contractor settlement.", authorisedSignatory: "Finance Team", showAttendance: false, periodLabel: "August 2026", periodStart: "2026-08-01", periodEnd: "2026-08-31", documentNumber: "CPS-202608-D0886", workerType: "contractor", workerCode: "D0886", workerName: "Test Contractor", locationName: "HO_KL", departmentName: "Operations", designationName: "SSA", paymentBasis: "monthly", expectedDays: 26, presentDays: 24, paidLeaveDays: 0, absenceDays: 2, halfDays: 0, grossPay: 25000, statutoryDeductions: 0, attendanceDeductions: 0, otherDeductions: 5000, employerContributions: 0, netPay: 20000, earnings: [{ name: "Contract pay", amount: 25000 }], deductions: [{ name: "Pay advance recovery", amount: 5000 }], publishedAt: "2026-08-31T12:00:00Z" });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("keeps many line items on a single page", async () => {
    const earnings = Array.from({ length: 40 }, (_, i) => ({ name: `Allowance ${i + 1}`, amount: 100 }));
    const bytes = await createPayDocumentPdf({ companyName: "DropX Logistics", registeredAddress: "23/337, Koodathingal Warehouse\nNeythukulangara Jn, Chevayur\nKozhikode, Kerala - 673017", periodLabel: "September 2026", periodStart: "2026-09-01", periodEnd: "2026-09-30", documentNumber: "PAY-202609-D0001", workerType: "employee", workerCode: "D0001", workerName: "Many Lines", locationName: null, departmentName: null, designationName: null, paymentBasis: null, expectedDays: 30, presentDays: 26, paidLeaveDays: 0, absenceDays: 0, halfDays: 0, weekoffDays: 4, grossPay: 4000, statutoryDeductions: 0, attendanceDeductions: 0, otherDeductions: 0, employerContributions: 0, netPay: 4000, earnings, deductions: [], salaryVersionsLabel: "V1 2026-09-01 → 2026-09-14 @ 20,000; V2 2026-09-15 → open @ 24,500", publishedAt: "2026-09-30T12:00:00Z" });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });
});

describe("inrWords", () => {
  it("uses the Indian numbering system", () => {
    expect(inrWords(200204)).toBe("INR Two Lakh Two Hundred Four Only");
    expect(inrWords(28440)).toBe("INR Twenty Eight Thousand Four Hundred Forty Only");
    expect(inrWords(0)).toBe("INR Zero Only");
  });

  it("includes paise", () => {
    expect(inrWords(16425.75)).toBe("INR Sixteen Thousand Four Hundred Twenty Five and Seventy Five Paise Only");
    expect(inrWords(0.5)).toBe("INR Zero and Fifty Paise Only");
  });
});

describe("parseSalaryVersionsLabel", () => {
  it("parses the legacy label, including open-ended versions", () => {
    expect(parseSalaryVersionsLabel("V1 2026-08-05 → 2026-09-23 @ 22,000; V2 2026-09-24 → open @ 24,500")).toEqual([
      { label: "V1", effectiveFrom: "2026-08-05", effectiveTo: "2026-09-23", monthlyAmount: 22000 },
      { label: "V2", effectiveFrom: "2026-09-24", effectiveTo: null, monthlyAmount: 24500 }
    ]);
    expect(parseSalaryVersionsLabel("V1 2026-08-01open @ 2,02,000")).toEqual([
      { label: "V1", effectiveFrom: "2026-08-01", effectiveTo: null, monthlyAmount: 202000 }
    ]);
  });
});
