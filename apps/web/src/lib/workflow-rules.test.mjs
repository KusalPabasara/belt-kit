import assert from "node:assert/strict";
import test from "node:test";

import {
  attendanceDocumentId,
  insuranceClaimDocumentId,
  normaliseAttendanceNote,
  reportDateRange,
  summariseAttendance,
} from "./workflow-rules.ts";

test("attendance records use one deterministic document per employee and day", () => {
  assert.equal(attendanceDocumentId("employee-7", "2026-08-04"), "employee-7_2026-08-04");
  assert.throws(() => attendanceDocumentId("", "2026-08-04"), /required/);
});

test("attendance notes are trimmed and status totals include absent and leave", () => {
  assert.equal(normaliseAttendanceNote("  Medical appointment  "), "Medical appointment");
  assert.equal(normaliseAttendanceNote(), "");
  assert.deepEqual(
    summariseAttendance([
      { status: "present" },
      { status: "present" },
      { status: "absent" },
      { status: "on_leave" },
    ]),
    { presentDays: 2, absentDays: 1, leaveDays: 1, totalDays: 4 },
  );
});

test("insurance claim ID is exactly the linked Job Card ID", () => {
  assert.equal(insuranceClaimDocumentId(" job-123 "), "job-123");
  assert.throws(() => insuranceClaimDocumentId("  "), /Job Card/);
});

test("report presets create the expected inclusive date ranges", () => {
  const now = new Date(2026, 7, 5, 10, 30);

  const all = reportDateRange("all", now);
  assert.deepEqual(all, { from: null, to: null });

  const today = reportDateRange("today", now);
  assert.equal(today.from?.getTime(), new Date(2026, 7, 5).getTime());
  assert.equal(today.to?.getTime(), new Date(2026, 7, 5, 23, 59, 59, 999).getTime());

  const week = reportDateRange("week", now);
  assert.equal(week.from?.getTime(), new Date(2026, 7, 3).getTime());

  const month = reportDateRange("month", now);
  assert.equal(month.from?.getTime(), new Date(2026, 7, 1).getTime());

  const threeMonths = reportDateRange("three_months", now);
  assert.equal(threeMonths.from?.getTime(), new Date(2026, 4, 8).getTime());
});

test("custom report dates pass through unchanged for validation by the page", () => {
  const from = new Date(2026, 6, 1);
  const to = new Date(2026, 6, 31, 23, 59, 59, 999);
  assert.deepEqual(reportDateRange("custom", new Date(), from, to), { from, to });
});
