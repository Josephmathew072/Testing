# Payslip PDF

`src/lib/pay-documents.ts` generates the DropX employee payslip and the contractor
payment statement as a single A4 page (`createPayDocumentPdf`). It is the replacement for the
Tally payslip and follows the layout used by large Indian employers' payroll systems
(ADP, Workday, greytHR).

Sample output is in [`docs/payslip-samples/`](payslip-samples/).

## Layout

1. **Letterhead**: company name and registered address on the left, logo on the right.
2. **Title bar**: "Payslip for the month of September 2026" (contractors: the
   `contractorStatementTitle`, e.g. "Contract Payment Statement").
3. **Employee details**: ruled grid with name, ID, designation, department, location, date of
   joining, bank account, pay period, PAN, UAN, PF number, ESI number, tax regime and PRAN.
   Tax Regime and PRAN are hidden when empty. UAN, PF and ESI are hidden for contractors when
   empty.
4. **Attendance details**: Total Days, Present, Half Days, Paid Leave, WFH, Week Off,
   LOP Days, Paid Days. `paidLeaveDays` includes WFH, so Paid Leave shows
   `paidLeaveDays - wfhDays`.
5. **Salary revision details**: only shown when the salary changed during the month
   (more than one version).
6. **Salary details**: Earnings and Deductions side by side, with Total Earnings and
   Total Deductions on the same row.
7. **Net Pay**: the amount, plus the amount in words (Indian numbering, including paise).
8. **Employer contributions**: shown when there are any.
9. **Footer**: disclaimer, document number and generated date.

Design rules: one palette only (grey label cells, white value cells, thin grey borders).
The DropX logo is the only colour on the page. No "take home" or "A - B" wording.

## Signature

Standard payslips are **computer-generated and unsigned**. This is the default.

- Indian wage rules require a wage slip, and an electronic one is accepted. They do not
  require it to be signed.
- Payroll systems issue unsigned payslips with the footer
  "This is a computer-generated payslip and does not require a signature."
- A typed "HR Head" under a blank line is not a signature and adds no authenticity, so the
  normal payslip has neither "For DROPX LOGISTICS" nor a signatory name.

**Signed copies** are for the occasional bank (loan), embassy (visa) or landlord request.
Generate them with `includeSignature: true`:

```ts
await createPayDocumentPdf({ ...input, includeSignature: true, authorisedSignatory: "HR Head" });
```

This adds "For DROPX LOGISTICS", a space for the hand signature and company seal, a signature
line and the `authorisedSignatory` title ("Authorised Signatory" if unset). The footer changes to
"This payslip is valid only with the authorised signatory's signature and company seal."
HR prints the PDF, signs it and stamps it with the company seal.

A custom `footerText` overrides the default footer in both cases.

## Input notes

| Field | Notes |
| --- | --- |
| `logoPng` | PNG bytes for the logo. Without it a "DropX" text wordmark is drawn. |
| `registeredAddress` | Split on newlines; long lines wrap. Up to 4 lines. |
| `earnings[].rate` | Optional full-month amount. When any earning has one, the table shows **Full Month** and **Earned** columns. |
| `salaryVersions` | Preferred over `salaryVersionsLabel`. The legacy label (`V1 2026-08-05 → 2026-09-23 @ 22,000; ...`) is still parsed. |
| `includeSignature` / `authorisedSignatory` | See [Signature](#signature). |
| `showAttendance` | Set `false` to hide the attendance table. |

If there are more earnings or deductions than fit on the page, the overflow is grouped into a
single "Other ... (n items)" row so the totals stay correct.

## Integration TODO (`dropx-hrms`)

- Load the logo and pass it in:
  ```ts
  import { readFile } from "node:fs/promises";
  import path from "node:path";
  const logoPng = await readFile(path.join(process.cwd(), "public", "dropx-logo.png"));
  await createPayDocumentPdf({ ...input, logoPng });
  ```
- Add a **Download signed copy** action for HR that passes `includeSignature: true`.
- Pass `rate` (full-month amount) on each earning to show the Full Month column.
- Check payable-days data: one generated D0845 slip showed 30 paid days alongside 15 absent
  days. That comes from the payroll calculation, not the PDF code.
