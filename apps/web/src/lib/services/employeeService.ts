"use client";

/**
 * Employee service — 100% client-side Firestore (no Cloud Functions).
 * ----------------------------------------------------------------------------
 * Free-tier safe. An "employee" is a document in the `users` collection (the
 * same doc that stores the login role), so employee management is just reading
 * and writing `users` docs, guarded by firestore.rules.
 *
 * Creating an employee also creates a real login. Since the browser client SDK
 * cannot create another user's account while keeping the owner signed in, we
 * reuse the project's established SECONDARY-app helper (`createStaffMember`),
 * which spins up a throwaway Firebase app to create the account, writes the
 * /users doc, then tears the secondary app down.
 */

import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { Employee, EmployeePayment } from "../models";
import { Role } from "../auth-context";
import { createStaffMember } from "../create-user";

type CreateEmployeeParams = {
  fullName: string;
  email: string;
  password: string;
  role: Role;
  phone?: string | null;
  salaryMinor?: number;
  joinDate?: string | null; // ISO date
  branchId?: string;
};

type UpdateEmployeeParams = {
  employeeId: string;
  updates?: {
    fullName?: string;
    role?: Role;
    phone?: string | null;
    salaryMinor?: number;
    joinDate?: string | null;
    active?: boolean;
    archived?: boolean;
  };
};

type CreatePaymentParams = {
  employeeId: string;
  month: string; // e.g. "2026-07"
  amountPaidMinor: number;
  paidDate?: string | null; // ISO date
};

/** Resolve the caller's branch from their own /users doc (default "main"). */
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

/**
 * Create a new employee: creates the login (secondary app) + writes the
 * remaining HR fields (salary, phone, joinDate) onto the same /users doc.
 */
export async function createEmployee(params: CreateEmployeeParams) {
  const branchId = params.branchId || (await currentBranchId());

  // 1) Create the login + base /users doc (role, displayName, email, active).
  const { uid } = await createStaffMember({
    name: params.fullName,
    email: params.email,
    password: params.password,
    role: params.role,
    branchId,
  });

  // 2) Add the employee-specific HR fields to the same doc.
  await updateDoc(doc(db, "users", uid), {
    fullName: params.fullName.trim(),
    phone: params.phone ?? null,
    salaryMinor: params.salaryMinor ?? 0,
    joinDate: params.joinDate ?? null,
    updatedAt: serverTimestamp(),
  });

  return { ok: true, uid };
}

/** Update an existing employee's HR fields on their /users doc. */
export async function updateEmployee(params: UpdateEmployeeParams) {
  const updates = params.updates ?? {};
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.fullName !== undefined) {
    payload.fullName = updates.fullName.trim();
    payload.displayName = updates.fullName.trim();
  }
  if (updates.role !== undefined) payload.role = updates.role;
  if (updates.phone !== undefined) payload.phone = updates.phone ?? null;
  if (updates.salaryMinor !== undefined) payload.salaryMinor = updates.salaryMinor;
  if (updates.joinDate !== undefined) payload.joinDate = updates.joinDate ?? null;
  if (updates.active !== undefined) payload.active = updates.active;
  if (updates.archived !== undefined) payload.archived = updates.archived;

  await updateDoc(doc(db, "users", params.employeeId), payload);
  return { ok: true };
}

/**
 * Fetch employees from the `users` collection. Optionally branch-scoped.
 * (Owner sees all; managers/attendance flows may pass branchScoped.)
 */
export async function getEmployees(options: { branchScoped?: boolean; branchId?: string } = {}) {
  const usersRef = collection(db, "users");
  let snap;
  if (options.branchScoped) {
    const branchId = options.branchId || (await currentBranchId());
    snap = await getDocs(query(usersRef, where("branchId", "==", branchId)));
  } else {
    snap = await getDocs(usersRef);
  }
  const employees = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Employee[];
  return { employees };
}

/** Record a salary/wage payment for an employee (own collection). */
export async function createEmployeePayment(params: CreatePaymentParams) {
  const branchId = await currentBranchId();
  const uid = auth.currentUser?.uid ?? "unknown";
  const { addDoc } = await import("firebase/firestore");
  const ref = await addDoc(collection(db, "employeePayments"), {
    employeeId: params.employeeId,
    month: params.month,
    amountPaidMinor: params.amountPaidMinor,
    paidDate: params.paidDate ?? null,
    branchId,
    archived: false,
    createdByUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { ok: true, id: ref.id };
}

/** Get all payments for one employee, newest first. */
export async function getEmployeePayments(employeeId: string) {
  const snap = await getDocs(
    query(collection(db, "employeePayments"), where("employeeId", "==", employeeId))
  );
  const payments = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as EmployeePayment)
    .sort((a, b) => (b.month || "").localeCompare(a.month || ""));
  return { payments };
}

/** Aggregated payment history for one employee. */
export async function getEmployeePaymentHistory(employeeId: string) {
  const { payments } = await getEmployeePayments(employeeId);
  const totalPaidMinor = payments.reduce(
    (sum, p) => sum + (p.amountPaidMinor ?? p.amountMinor ?? 0),
    0
  );
  return { history: payments, payments, totalPaidMinor };
}

export default {
  createEmployee,
  updateEmployee,
  getEmployees,
  createEmployeePayment,
  getEmployeePayments,
  getEmployeePaymentHistory,
};
