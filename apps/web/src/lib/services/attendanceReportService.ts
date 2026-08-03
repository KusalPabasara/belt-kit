"use client";

/**
 * Attendance report — 100% client-side PDF generation (no Cloud Functions).
 * Free-tier safe. Builds the PDF in the browser with jsPDF from Firestore data,
 * keeping the same `downloadAttendanceReport(request)` signature callers use.
 */

import { jsPDF } from "jspdf";
import { getAttendanceList } from "./attendanceService";
import { getEmployees } from "./employeeService";
import type { Attendance } from "../types/attendance";

export type AttendanceReportRequest =
  | { reportType: "month"; month: string }
  | { reportType: "person"; month: string; employeeId: string };

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function statusLabel(status: string) {
  return status === "present"
    ? "Present"
    : status === "absent"
      ? "Absent"
      : status === "on_leave"
        ? "On Leave"
        : status;
}

export async function downloadAttendanceReport(
  request: AttendanceReportRequest
): Promise<void> {
  if (!MONTH_PATTERN.test(request.month)) {
    throw new Error("Select a valid attendance month before downloading.");
  }
  if (request.reportType === "person" && !request.employeeId.trim()) {
    throw new Error("Employee ID is required for a person attendance report.");
  }

  // 1) Pull the attendance rows for the month (optionally one employee).
  const { attendance } = await getAttendanceList({
    month: request.month,
    ...(request.reportType === "person" ? { employeeId: request.employeeId } : {}),
  });

  // 2) Map employee IDs -> display names.
  const nameById = new Map<string, string>();
  try {
    const { employees } = await getEmployees();
    for (const e of employees) {
      nameById.set(
        e.id,
        (e as { fullName?: string; displayName?: string }).fullName ||
          (e as { displayName?: string }).displayName ||
          e.id
      );
    }
  } catch {
    // Names are best-effort; fall back to IDs.
  }

  const rows = [...attendance].sort((a, b) => {
    const byName = (nameById.get(a.employeeId) || a.employeeId).localeCompare(
      nameById.get(b.employeeId) || b.employeeId
    );
    return byName !== 0 ? byName : (a.date || "").localeCompare(b.date || "");
  });

  // 3) Build the PDF.
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const marginX = 40;
  let y = 54;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("Belt-Kit — Attendance Report", marginX, y);
  y += 22;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(`Month: ${request.month}`, marginX, y);
  y += 16;
  if (request.reportType === "person") {
    const who = nameById.get(request.employeeId) || request.employeeId;
    pdf.text(`Employee: ${who}`, marginX, y);
    y += 16;
  }
  const present = rows.filter((r) => r.status === "present").length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const leave = rows.filter((r) => r.status === "on_leave").length;
  pdf.text(`Records: ${rows.length}   Present: ${present}   Absent: ${absent}   On Leave: ${leave}`, marginX, y);
  y += 24;

  // Table header.
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  const colEmployee = marginX;
  const colDate = marginX + 220;
  const colStatus = marginX + 340;
  const colNote = marginX + 430;
  pdf.text("Employee", colEmployee, y);
  pdf.text("Date", colDate, y);
  pdf.text("Status", colStatus, y);
  pdf.text("Note", colNote, y);
  y += 8;
  pdf.setDrawColor(180);
  pdf.line(marginX, y, pageWidth - marginX, y);
  y += 14;

  pdf.setFont("helvetica", "normal");
  const pageBottom = pdf.internal.pageSize.getHeight() - 40;

  if (rows.length === 0) {
    pdf.text("No attendance records for this period.", marginX, y);
  }

  for (const r of rows as Attendance[]) {
    if (y > pageBottom) {
      pdf.addPage();
      y = 54;
    }
    const name = nameById.get(r.employeeId) || r.employeeId;
    pdf.text(String(name).slice(0, 34), colEmployee, y);
    pdf.text(r.date || "", colDate, y);
    pdf.text(statusLabel(r.status), colStatus, y);
    pdf.text(String(r.note || "").slice(0, 30), colNote, y);
    y += 16;
  }

  const suffix = request.reportType === "person" ? `-${request.employeeId}` : "";
  pdf.save(`attendance-${request.month}${suffix}.pdf`);
}

export default { downloadAttendanceReport };
