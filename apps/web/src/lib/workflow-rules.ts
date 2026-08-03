import type { Attendance } from "./types/attendance";

export type ReportPeriod = "all" | "today" | "week" | "month" | "three_months" | "custom";

export function attendanceDocumentId(employeeId: string, date: string): string {
  const cleanEmployeeId = employeeId.trim();
  const cleanDate = date.trim();
  if (!cleanEmployeeId || !cleanDate) {
    throw new Error("Employee and date are required.");
  }
  return `${cleanEmployeeId}_${cleanDate}`;
}

export function normaliseAttendanceNote(note?: string): string {
  return note?.trim() ?? "";
}

export function summariseAttendance(records: Pick<Attendance, "status">[]) {
  const presentDays = records.filter((record) => record.status === "present").length;
  const absentDays = records.filter((record) => record.status === "absent").length;
  const leaveDays = records.filter((record) => record.status === "on_leave").length;
  return { presentDays, absentDays, leaveDays, totalDays: records.length };
}

export function insuranceClaimDocumentId(jobCardId: string): string {
  const claimId = jobCardId.trim();
  if (!claimId) throw new Error("A delivered Job Card is required.");
  return claimId;
}

export function reportDateRange(
  period: ReportPeriod,
  now: Date,
  customFrom: Date | null = null,
  customTo: Date | null = null,
): { from: Date | null; to: Date | null } {
  if (period === "custom") return { from: customFrom, to: customTo };
  if (period === "all") return { from: null, to: null };

  const to = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
  let from = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === "week") {
    const daysSinceMonday = (from.getDay() + 6) % 7;
    from.setDate(from.getDate() - daysSinceMonday);
  } else if (period === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === "three_months") {
    from.setDate(from.getDate() - 89);
  }

  return { from, to };
}
