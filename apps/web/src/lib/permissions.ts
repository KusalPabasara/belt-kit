import { Role } from "./auth-context";

/**
 * Central permission map — mirrors firestore.rules.
 *
 * Roles:
 *   owner / manager  — everything
 *   advisor          — "Front Desk": full CRUD on customers/vehicles/jobs,
 *                      assign technicians, add members, invoices + payments
 *   technician       — see assigned jobs, change status, add parts to them
 *   accountant       — view jobs; invoices + payments
 *   customer         — own records (portal, later)
 */

const READABLE: Record<Role, string[]> = {
  owner: [
    "jobCards", "jobCardLines", "customers", "vehicles",
    "parts", "stockMovements", "invoices", "payments", "users",
    "branches", "auditLog","services","insuranceClaims",
  ],
  manager: [
    "jobCards", "jobCardLines", "customers", "vehicles",
    "parts", "stockMovements", "invoices", "payments", "users",
    "branches", "auditLog","services","insuranceClaims",
  ],
  advisor: [
    "jobCards", "jobCardLines", "customers", "vehicles",
    "parts", "stockMovements", "invoices", "payments", "users",
    "branches", "auditLog","services","insuranceClaims",
  ],
  technician: ["jobCards", "jobCardLines", "vehicles", "parts", "branches", "assistantChats", "assistantMessages"],
  accountant: [
    "jobCards", "jobCardLines", "customers", "vehicles",
    "parts", "stockMovements", "invoices", "payments", "branches", "auditLog",
    "insuranceClaims",
  ],
  customer: ["invoices", "payments"],
  pending: [],
};

export function canRead(role: Role | null, collection: string): boolean {
  if (!role) return false;
  return READABLE[role]?.includes(collection) ?? false;
}

// ---- Action helpers (mirror the write rules) ------------------------------

// Ops = owner, manager, front-desk. Full CRUD on operational records.
const isOps = (r: Role | null) =>
  r === "owner" || r === "manager" || r === "advisor";

export const canManageCustomers = isOps;
export const canManageVehicles = isOps;
export const canCreateJobs = isOps;
export const canDeleteRecords = isOps; // customers/vehicles/jobs delete

export const canEditJobLines = (r: Role | null) =>
  isOps(r) || r === "technician";

export const canChangeJobStatus = (r: Role | null) =>
  isOps(r) || r === "technician";

export const canManageInventory = (r: Role | null) =>
  r === "owner" || r === "manager" || r === "advisor";

// Financial actions: invoices + payments. Front-desk included per request.
export const canDoFinancial = (r: Role | null) =>
  r === "owner" || r === "manager" || r === "advisor" || r === "accountant";

// Package 3 reports combine finance, completed jobs, customers, vehicles and
// inventory. This deliberately matches the roles exposed in dashboard nav.
export const canViewReports = canDoFinancial;

// Insurance cases contain identity and settlement information. Technicians use
// the linked Job Card for repair work and do not need access to this workspace.
export const canViewInsurance = (r: Role | null) =>
  r === "owner" || r === "manager" || r === "advisor" || r === "accountant";

export const canManageInsuranceCases = isOps;

export const canManageInsuranceSettlement = (r: Role | null) =>
  r === "owner" || r === "manager" || r === "advisor" || r === "accountant";

// Add staff members + assign roles: owner, manager, front-desk.
export const canManageUsers = isOps;

// Assign technicians to a job.
export const canAssignTechnicians = isOps;

export const canManageServices = (r: Role | null) =>
  r === "owner" || r === "manager" || r === "advisor";
