/** Client-side model types (mirror of functions/src/types.ts). */
import { Timestamp } from "firebase/firestore";
import { Role } from "./auth-context";

export interface Branch {
  name: string;
  currency: string;
  taxRatePercent: number;
  timezone: string;
  archived?: boolean;
}

export interface Customer {
  branchId: string;
  displayName: string;
  phone: string;
  email?: string;
  preferredChannel: "sms" | "whatsapp" | "email";
  segment?: "vip" | "fleet" | "walkin";
  archived?: boolean;
  createdAt?: Timestamp;
}

export interface Vehicle {
  branchId: string;
  customerId: string;
  plateNumber: string;
  vin?: string;
  make: string;
  model: string;
  year?: number;
  engine?: string;
  archived?: boolean;
  createdAt?: Timestamp;
}

export type JobStatus =
  | "booked"
  | "in_progress"
  | "awaiting_parts"
  | "qc"
  | "ready"
  | "delivered";

export interface JobCard {
  id?: string;
  branchId: string;

  customerId: string;
  vehicleId: string;

  complaint: string;

  // Service types selected for this job.
  serviceTypeIds: string[];

  assignedTechnicianIds: string[];
  status: JobStatus;

  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** Pricing choices made on the job card before its invoice is generated. */
  taxRatePercent?: number;
  extraCharges?: ExtraCharge[];
  discountType?: DiscountType;
  discountValue?: number;
  discountMinor?: number;
  invoiceId?: string | null;

  // Scheduling / dates.
  scheduledDate?: Timestamp | null;
  startDate?: Timestamp | null;
  promisedEndDate?: Timestamp | null;
  actualEndDate?: Timestamp | null;
  completionNotes?: string;

  // Vehicle check-in / inspection.
  odometerReading?: number | null;
  fuelLevel?: "Empty" | "Quarter" | "Half" | "Full" | string | null;
  existingDamage?: {
    scratches?: boolean;
    dents?: boolean;
    crackedGlass?: boolean;
    notes?: string;
  } | null;

  // Before / after photos.
  photos?: {
    before?: string[];
    after?: string[];
  } | null;

  delayNote?: string | null;

  archived?: boolean;
  createdAt?: Timestamp;
}

export interface JobCardLine {
  branchId: string;
  jobCardId: string;
  kind: "labor" | "part";
  description: string;
  partId?: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  archived?: boolean;
  createdAt?: Timestamp;
}

export interface Part {
  branchId: string;
  sku: string;
  name: string;
  costPriceMinor: number;
  sellPriceMinor: number;
  quantityOnHand: number;
  reorderThreshold: number;
  lowStock: boolean;
  binLocation?: string;
  archived?: boolean;
  createdAt?: Timestamp;
}

export interface ServiceType {
  branchId: string;
  name: string;
  defaultPriceMinor: number;
  estimatedDays: number;
  active: boolean;
  archived?: boolean;
  createdAt?: Timestamp;
}

export interface StockMovement {
  branchId: string;
  partId: string;
  delta: number;
  reason: "job_use" | "purchase" | "adjustment" | "return";
  jobCardId?: string | null;
  archived?: boolean;
  createdAt?: Timestamp;
}

export type InsuranceClaimStatus =
  | "pending"
  | "approved"
  | "received"
  | "rejected";


export interface InsuranceClaim {

  id:string;

  branchId:string;

  jobCardId:string;

  customerId:string;

  vehicleId:string;


  companyName:string;

  policyNumber?:string;

  claimNumber?:string;


  claimAmountMinor:number;

  receivedAmountMinor:number;


  status:InsuranceClaimStatus;


  notes?:string;


  archived?:boolean;

  createdAt:any;

}

export type AssistantMessageRole = "user" | "assistant";

export interface AssistantAnswer {
  summary: string;
  urgency: "routine" | "soon" | "stop_and_inspect";
  likelyCauses: string[];
  nextChecks: string[];
  toolsOrParts: string[];
  safetyWarning: string | null;
  followUpQuestion: string;
}

export interface AssistantChat {
  branchId: string;
  ownerUid: string;
  title: string;
  lastMessagePreview?: string;
  updatedAt?: Timestamp;
  createdAt?: Timestamp;
  archived?: boolean;
}

export interface AssistantAttachment {
  name: string;
  mimeType: string;
  size: number;
  /** Stored metadata only; the file content is sent to Ollama per request. */
}

export interface AssistantMessage {
  branchId: string;
  chatId: string;
  ownerUid: string;
  role: AssistantMessageRole;
  content: string;
  answer?: AssistantAnswer;
  sources?: string[];
  attachments?: AssistantAttachment[];
  createdAt?: Timestamp;
}

export type InvoiceStatus = "draft" | "issued" | "part_paid" | "paid" | "void";

export type DiscountType = "percent" | "fixed";

export interface ExtraCharge {
  description: string;
  amountMinor: number;
}

export interface Invoice {
  branchId: string;
  jobCardId: string;
  customerId: string;
  status: InvoiceStatus;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  /** Tax percentage frozen when the invoice is created. */
  taxRatePercent?: number;
  /** Optional manual charges and discount. Missing on legacy invoices. */
  extraCharges?: ExtraCharge[];
  discountType?: DiscountType;
  /** Percentage points for percent discounts; minor units for fixed discounts. */
  discountValue?: number;
  discountMinor?: number;
  lines: Array<{
    description: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    kind?: "labor" | "part";
    partId?: string | null;
    /** Part cost frozen at invoice time for stable profit reporting. */
    costPriceMinor?: number;
  }>;
  archived?: boolean;
  createdAt?: Timestamp;
}

export interface Payment {
  branchId: string;
  invoiceId: string;
  customerId: string;
  amountMinor: number;
  method: "cash" | "card" | "bank_transfer" | "wallet";
  reference?: string;
  /** Safe display metadata only. Full card details and CVV are never stored. */
  cardLast4?: string;
  provider?: string;
  createdAt?: Timestamp;
}

// ---- Employees (client-side mirror for functions-backed employee APIs) ---
export interface Employee {
  id: string;
  uid?: string;

  // Some records use `displayName`, others use `fullName` — accept both.
  fullName?: string;
  displayName?: string;

  email: string;
  role: Role;

  branchId: string;

  phone?: string;

  salaryMinor?: number; // stored in minor units (e.g., cents)

  // backend may store joinDate as a string (ISO) or Timestamp
  joinDate?: string | Timestamp | null;

  active: boolean;
  archived?: boolean;
  createdAt?: Timestamp | unknown;
}

export interface EmployeePayment {
  id?: string;
  employeeId: string;
  month: string; // e.g. "2026-07"
  amountPaidMinor: number;
  amountMinor?: number;
  paidDate?: Timestamp | string | null;
  createdAt?: Timestamp | unknown;
}

export const JOB_STATUS_META: Record<
  JobStatus,
  { label: string; tone: "neutral" | "blue" | "amber" | "gold" | "green" | "burgundy" }
> = {
  booked: { label: "Booked", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "blue" },
  awaiting_parts: { label: "Awaiting Parts", tone: "amber" },
  qc: { label: "Quality Check", tone: "gold" },
  ready: { label: "Ready", tone: "green" },
  delivered: { label: "Delivered", tone: "burgundy" },
};

export const JOB_STATUS_ORDER: JobStatus[] = [
  "booked",
  "in_progress",
  "awaiting_parts",
  "qc",
  "ready",
  "delivered",
];
