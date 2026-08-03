/**
 * BELT-KIT — Firestore Data Model (Phase 1 MVP)
 * ----------------------------------------------------------------------------
 * These TypeScript interfaces ARE your database schema. Firestore is
 * schema-less, so this file is the single source of truth for what shape each
 * document has. Every collection below maps to a top-level Firestore
 * collection of the same name.
 *
 * Spec rules encoded here:
 *   - Every business record carries `branchId` (multi-branch safe from day 1).
 *   - No hard deletes: records carry `archived` instead.
 *   - Money is stored as integer minor units (e.g. cents) to avoid float bugs.
 *   - Line items store the price AT THE TIME (`unitPriceMinor`) so old invoices
 *     never change when the catalogue price changes later.
 *   - Financial/status changes get an AuditLogEntry (written by a Function).
 */

import type {
  Timestamp,
} from "firebase-admin/firestore";

/** The fixed set of roles from the spec's permission matrix. */
export type Role =
  | "owner"
  | "manager"
  | "advisor"
  | "technician"
  | "accountant"
  | "customer";

/** Fields every business document shares. */
export interface BaseDoc {
  branchId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdByUid: string;
  archived: boolean;
}

// ---- Branches --------------------------------------------------------------

export interface Branch {
  name: string;
  currency: string;
  taxRatePercent: number;
  timezone: string;
  createdAt: Timestamp;
  archived: boolean;
}

// ---- Users / staff ---------------------------------------------------------

export interface UserProfile {
  branchId: string;
  role: Role;
  displayName: string;
  email: string;
  phone?: string;
  active: boolean;
  createdAt: Timestamp;
}

// ---- Customers (CRM) -------------------------------------------------------

export interface Customer extends BaseDoc {
  displayName: string;
  phone: string;
  email?: string;
  preferredChannel:
    | "sms"
    | "whatsapp"
    | "email";
  segment?:
    | "vip"
    | "fleet"
    | "walkin";
  portalUid?: string | null;
}

// ---- Vehicles --------------------------------------------------------------

export interface Vehicle extends BaseDoc {
  customerId: string;
  plateNumber: string;
  vin?: string;
  make: string;
  model: string;
  year?: number;
  engine?: string;
}

// ---- Job Cards / Repair Orders --------------------------------------------

export type JobStatus =
  | "booked"
  | "in_progress"
  | "awaiting_parts"
  | "qc"
  | "ready"
  | "delivered";

export interface JobCard extends BaseDoc {
  customerId: string;
  vehicleId: string;
  complaint: string;
  status: JobStatus;
  assignedTechnicianIds: string[];

  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  invoiceId?: string | null; // set once an invoice is generated

  /**
   * The next planned service date.
   * Populated when the job is completed/delivered so the service-reminder
   * notification can be scheduled.
   */
  nextServiceDate?: Timestamp | null;

  /** Pricing choices made on the job card before its invoice is generated. */
  taxRatePercent?: number;
  extraCharges?: ExtraCharge[];
  discountType?: DiscountType;
  discountValue?: number;
  discountMinor?: number;
}

/** A single labor or parts line on a job card. */
export interface JobCardLine extends BaseDoc {
  jobCardId: string;
  kind: "labor" | "part";
  description: string;
  partId?: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

// ---- Inventory -------------------------------------------------------------

export interface Part extends BaseDoc {
  sku: string;
  name: string;
  costPriceMinor: number;
  sellPriceMinor: number;
  quantityOnHand: number;
  reorderThreshold: number;
  lowStock: boolean;
  binLocation?: string;
}

/** Append-only record of stock going in or out. */
export interface StockMovement extends BaseDoc {
  partId: string;
  delta: number;
  reason:
    | "job_use"
    | "purchase"
    | "adjustment"
    | "return";
  jobCardId?: string | null;
}

// ---- Billing ---------------------------------------------------------------

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "part_paid"
  | "paid"
  | "void";

export type DiscountType = "percent" | "fixed";

export interface ExtraCharge {
  description: string;
  amountMinor: number;
}

export interface Invoice extends BaseDoc {
  jobCardId: string;
  customerId: string;
  customerUid?: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  taxRatePercent?: number;
  extraCharges?: ExtraCharge[];
  discountType?: DiscountType;
  /** Percentage points for percent discounts; minor units for fixed discounts. */
  discountValue?: number;
  discountMinor?: number;
  // Snapshot of the lines at invoice time so history is frozen.
  lines: Array<{
    description: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    kind?: "labor" | "part";
    partId?: string | null;
    costPriceMinor?: number;
  }>;
}

export interface Payment extends BaseDoc {
  invoiceId: string;
  customerId: string;
  customerUid?: string | null;
  amountMinor: number;
  method:
    | "cash"
    | "card"
    | "bank_transfer"
    | "wallet";
  reference?: string;
  cardLast4?: string;
  provider?: string;
}

// ---- Audit log -------------------------------------------------------------

export interface AuditLogEntry {
  branchId: string;
  actorUid: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  at: Timestamp;
}

// ---- Employee Payments -----------------------------------------------------

export interface EmployeePayment {
  employeeId: string;
  branchId: string;

  month: string;

  amountPaidMinor: number;

  paidDate: string;

  createdBy: string;
}

// ---- Employee Payments -----------------------------------------------------

export interface EmployeePayment extends BaseDoc {
  employeeId: string;

  month: string;

  amountPaidMinor: number;

  datePaid: string;

  note?: string;
}

// ---- Attendance ------------------------------------------------------------

export type AttendanceStatus =
  | "present"
  | "absent"
  | "on_leave";

export interface Attendance {
  id: string;

  employeeId: string;

  /**
   * Required for branch isolation and for sending the alert
   * only to front-desk users in the same branch.
   */
  branchId: string;

  /**
   * Format: YYYY-MM-DD
   */
  date: string;

  status: AttendanceStatus;

  /**
   * Optional note entered by the manager/front desk.
   */
  note?: string;

  createdAt?: Timestamp;

  updatedAt?: Timestamp;
}

// ---- Suppliers -------------------------------------------------------------

export interface Supplier {
  name: string;

  phone: string;

  email: string;

  branchId: string;
}

export interface PurchaseItem {
  name: string;

  quantity: number;

  cost: number;
}

// ---- Notifications ---------------------------------------------------------

export type NotificationType =
  | "LOW_STOCK"
  | "NEXT_SERVICE"
  | "EMPLOYEE_ON_LEAVE";

export type NotificationTargetType =
  | "PART"
  | "VEHICLE"
  | "JOB_CARD"
  | "ATTENDANCE";

export interface CreateBranchNotificationInput {
  branchId: string;

  type: NotificationType;

  title: string;
  message: string;

  targetType: NotificationTargetType;
  targetId: string;

  /**
   * Used to generate deterministic document IDs and prevent
   * duplicate notifications when Firebase retries an event.
   */
  sourceEventId: string;

  relatedPartId?: string;
  relatedVehicleId?: string;
  relatedJobCardId?: string;

  /**
   * Employee-leave notification relationships.
   */
  relatedEmployeeId?: string;
  relatedAttendanceId?: string;
  attendanceDate?: string;

  /**
   * Optional recipient-role override.
   *
   * Employee-on-leave alerts use this to send only to
   * front-desk/advisor users.
   */
  allowedRoles?: readonly string[];
}

export interface NotificationDocument {
  branchId: string;
  recipientUid: string;

  type: NotificationType;

  title: string;
  message: string;

  targetType: NotificationTargetType;
  targetId: string;

  sourceEventId: string;

  relatedPartId?: string;
  relatedVehicleId?: string;
  relatedJobCardId?: string;

  relatedEmployeeId?: string;
  relatedAttendanceId?: string;
  attendanceDate?: string;

  isRead: boolean;
  readAt: Timestamp | null;

  createdAt: Timestamp;
}

export interface ServiceReminderDocument {
  branchId: string;

  jobCardId: string;
  vehicleId: string;

  customerId?: string;
  vehicleRegistration?: string;

  nextServiceDate: Timestamp;
  notifyAt: Timestamp;

  notifiedAt: Timestamp | null;
  notificationCount?: number;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
