"use client";

/**
 * Attendance service — 100% client-side Firestore (no Cloud Functions).
 * Free-tier safe. Documents live in `attendance`, keyed deterministically as
 * `${employeeId}_${date}` so marking the same person on the same day UPDATES
 * rather than creating a duplicate. Guarded by firestore.rules.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import type { Attendance, AttendanceStatus } from "../types/attendance";
import {
  attendanceDocumentId,
  normaliseAttendanceNote,
  summariseAttendance,
} from "../workflow-rules";

type CreateAttendancePayload = {
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  note?: string;
};

type GetAttendanceListPayload = {
  employeeId?: string;
  month?: string; // "YYYY-MM"
};

export type SaveAttendanceResponse = {
  success: boolean;
  attendanceId: string;
  operation: "created" | "updated";
};

type AttendanceSummaryResponse = {
  success: boolean;
  employeeId: string;
  month: string;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  totalDays: number;
};

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new Error("No authenticated user available for attendance update.");
  return user;
}

/** Caller's branch from their own /users doc (default "main"). */
async function currentBranchId(): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) return "main";
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return (snap.data()?.branchId as string) || "main";
  } catch {
    return "main";
  }
}

/** Create or update the attendance record for one employee on one day. */
export async function createAttendance(
  payload: CreateAttendancePayload
): Promise<SaveAttendanceResponse> {
  const uid = requireUser().uid;
  if (!payload.employeeId || !payload.date) {
    throw new Error("Employee and date are required.");
  }
  const branchId = await currentBranchId();
  const id = attendanceDocumentId(payload.employeeId, payload.date);
  const ref = doc(db, "attendance", id);

  const existing = await getDoc(ref);
  const operation: "created" | "updated" = existing.exists() ? "updated" : "created";

  await setDoc(
    ref,
    {
      employeeId: payload.employeeId,
      date: payload.date,
      status: payload.status,
      note: normaliseAttendanceNote(payload.note),
      branchId,
      archived: false,
      ...(existing.exists() ? {} : { createdByUid: uid, createdAt: serverTimestamp() }),
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true, attendanceId: id, operation };
}

/** List attendance, optionally filtered by employee and/or month ("YYYY-MM"). */
export async function getAttendanceList(params: GetAttendanceListPayload = {}) {
  requireUser();
  const branchId = await currentBranchId();

  const filters = [where("branchId", "==", branchId)];
  if (params.employeeId) filters.push(where("employeeId", "==", params.employeeId));

  const snap = await getDocs(query(collection(db, "attendance"), ...filters));
  let attendance = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Attendance);

  // Month filter is applied client-side against the "YYYY-MM-DD" date string.
  if (params.month) {
    attendance = attendance.filter((a) => (a.date || "").startsWith(params.month!));
  }
  attendance.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return { success: true, attendance };
}

/** Monthly present/leave summary for one employee. */
export async function getAttendanceSummary(
  employeeId: string,
  month: string
): Promise<AttendanceSummaryResponse> {
  const { attendance } = await getAttendanceList({ employeeId, month });
  const { presentDays, absentDays, leaveDays, totalDays } = summariseAttendance(attendance);
  return {
    success: true,
    employeeId,
    month,
    presentDays,
    absentDays,
    leaveDays,
    totalDays,
  };
}

export default {
  createAttendance,
  getAttendanceList,
  getAttendanceSummary,
};
