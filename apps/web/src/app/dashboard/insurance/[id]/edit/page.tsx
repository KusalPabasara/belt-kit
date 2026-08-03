"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import {
  AlertCircle,
  ClipboardCheck,
  FileText,
  Landmark,
  ReceiptText,
  ShieldCheck,
  UploadCloud,
  WalletCards,
} from "lucide-react";

import { Field, PageHeader, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { auth, db } from "@/lib/firebase";
import { formatMoney, toMinor } from "@/lib/format";
import { InsuranceClaim } from "@/lib/models";

type DateLike = string | Date | { toDate?: () => Date; seconds?: number } | null;

type InsuranceCase = InsuranceClaim & {
  caseStage?: string;
  approvalStatus?: string;
  releaseStatus?: string;
  settlementStatus?: string;
  accidentDate?: DateLike;
  paymentRoute?: string;
  assessorName?: string;
  assessmentDate?: DateLike;
  assessmentReference?: string;
  finalInvoiceTotalMinor?: number;
  finalInvoiceAmountMinor?: number;
  assessedAmountMinor?: number;
  approvedAmountMinor?: number;
  insurerResponsibilityMinor?: number;
  customerResponsibilityMinor?: number;
  insurerReceivedMinor?: number;
  customerReceivedMinor?: number;
  writeOffMinor?: number;
  releaseOrderNumber?: string;
  releaseOrderDate?: DateLike;
  expectedSettlementDate?: DateLike;
  regulatorySettlementDate?: DateLike;
  quantumEstablishedAt?: DateLike;
  dischargeDocumentsReceivedAt?: DateLike;
  releasedAt?: DateLike;
  insurerPaymentMethod?: string;
  insurerPaymentReference?: string;
  customerPaymentReference?: string;
  chequeStatus?: string;
  chequeReceivedAt?: DateLike;
  chequeClearedAt?: DateLike;
  settlementNotes?: string;
};

const DOCUMENTS = [
  "Claim form and accident report",
  "Customer payment authorisation",
  "Assessor estimate / settlement advice",
  "Parts quotations and revised estimates",
  "Release order or payment undertaking",
];

const CASE_STAGE_LABELS: Record<string, string> = {
  intake: "Intake",
  documents: "Documents",
  assessment: "Assessment",
  approval: "Approval",
  repair: "Repair",
  final_invoice: "Final invoice",
  release: "Release",
  settlement: "Settlement",
  closed: "Closed",
};

const CASE_STAGE_TRANSITIONS: Record<string, string[]> = {
  intake: ["documents", "assessment"],
  documents: ["intake", "assessment"],
  assessment: ["documents", "approval"],
  approval: ["assessment", "repair", "final_invoice", "release"],
  repair: ["approval", "final_invoice"],
  final_invoice: ["repair", "release"],
  release: ["final_invoice", "settlement"],
  settlement: ["release", "closed"],
  closed: [],
};

const RELEASE_LABELS: Record<string, string> = {
  blocked: "Blocked",
  eligible: "Eligible for release",
  release_order_verified: "Release order verified",
  authorized: "Authorised",
  released: "Vehicle released",
};

const RELEASE_TRANSITIONS: Record<string, string[]> = {
  blocked: ["eligible"],
  eligible: ["blocked", "release_order_verified", "authorized"],
  release_order_verified: ["eligible", "released"],
  authorized: ["eligible", "released"],
  released: [],
};

const APPROVAL_LABELS: Record<string, string> = {
  pending: "Pending",
  partly_approved: "Partly approved",
  partially_approved: "Partially approved",
  approved: "Approved",
  rejected: "Rejected",
  disputed: "Disputed",
};

const APPROVAL_TRANSITIONS: Record<string, string[]> = {
  pending: ["partly_approved", "partially_approved", "approved", "rejected", "disputed"],
  partly_approved: ["pending", "approved", "rejected", "disputed"],
  partially_approved: ["pending", "approved", "rejected", "disputed"],
  approved: ["disputed"],
  rejected: ["pending", "disputed"],
  disputed: ["pending", "partly_approved", "partially_approved", "approved", "rejected"],
};

const SETTLEMENT_LABELS: Record<string, string> = {
  not_due: "Not due",
  insurer_pending: "Insurer payment pending",
  customer_pending: "Customer payment pending",
  part_paid: "Part paid",
  overdue: "Overdue",
  disputed: "Disputed",
  reconciled: "Reconciled and closed",
};

const SETTLEMENT_TRANSITIONS: Record<string, string[]> = {
  not_due: ["insurer_pending", "customer_pending", "part_paid", "overdue", "disputed", "reconciled"],
  insurer_pending: ["customer_pending", "part_paid", "overdue", "disputed", "reconciled"],
  customer_pending: ["insurer_pending", "part_paid", "overdue", "disputed", "reconciled"],
  part_paid: ["insurer_pending", "customer_pending", "overdue", "disputed", "reconciled"],
  overdue: ["insurer_pending", "customer_pending", "part_paid", "disputed", "reconciled"],
  disputed: ["insurer_pending", "customer_pending", "part_paid", "overdue", "reconciled"],
  reconciled: [],
};

function availableTransitions(current: string, transitions: Record<string, string[]>) {
  return [current, ...(transitions[current] ?? [])].filter(
    (value, index, values) => value && values.indexOf(value) === index,
  );
}

function timestampFromDateInput(value: string) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : Timestamp.fromDate(parsed);
}

function text(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function moneyDefault(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? (value / 100).toFixed(2)
    : "";
}

function dateDefault(value?: DateLike) {
  if (!value) return "";
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    date = new Date(value);
  } else if (typeof value.toDate === "function") date = value.toDate();
  else if (typeof value.seconds === "number") date = new Date(value.seconds * 1000);
  else return "";

  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function deriveLegacyStatus(approvalStatus: string, settlementStatus: string) {
  if (approvalStatus === "rejected") return "rejected";
  if (settlementStatus === "reconciled") return "received";
  if (
    approvalStatus === "approved" ||
    approvalStatus === "partly_approved" ||
    approvalStatus === "partially_approved"
  ) {
    return "approved";
  }
  return "pending";
}

function legacyStage(claim: InsuranceCase) {
  if (claim.caseStage) return claim.caseStage;
  if (claim.status === "received") return "settlement";
  if (claim.status === "approved" || claim.status === "rejected") return "approval";
  return "intake";
}

export default function EditInsurancePage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { notify } = useToast();
  const { role, roleResolved } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [claim, setClaim] = useState<InsuranceCase | null>(null);

  const canManage = role === "owner" || role === "manager" || role === "advisor";
  const canRecordSettlement = role === "accountant";
  const canAccess = canManage || canRecordSettlement;

  useEffect(() => {
    let active = true;

    async function load() {
      if (!roleResolved) return;
      if (!canAccess) {
        if (active) setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "insuranceClaims", id));
        if (!snap.exists()) {
          notify("Insurance case not found", "error");
          router.push("/dashboard/insurance");
          return;
        }

        if (active) {
          setClaim({ id: snap.id, ...snap.data() } as unknown as InsuranceCase);
        }
      } catch (error) {
        console.error("LOAD INSURANCE EDIT ERROR", error);
        notify("Could not load the insurance case", "error");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [canAccess, id, notify, roleResolved, router]);

  async function save(form: FormData) {
    const uid = auth.currentUser?.uid;
    const legacyReadOnly = claim?.schemaVersion !== 2 || claim?.id !== claim?.jobCardId;
    if (!claim || !uid || !canManage || legacyReadOnly) {
      notify(!uid ? "Sign in before editing this case" : "You cannot edit this insurance case", "error");
      return;
    }

    const approvalStatus = text(form, "approvalStatus") || "pending";
    const releaseStatus = text(form, "releaseStatus") || "blocked";
    const settlementStatus = text(form, "settlementStatus") || "not_due";
    const insurerReceivedMinor = toMinor(text(form, "insurerReceived"));
    const customerReceivedMinor = toMinor(text(form, "customerReceived"));
    const insurerResponsibilityMinor = toMinor(text(form, "insurerResponsibility"));
    const customerResponsibilityMinor = toMinor(text(form, "customerResponsibility"));
    const writeOffMinor = toMinor(text(form, "writeOff"));
    const releaseOrderNumber = text(form, "releaseOrderNumber");
    const releaseOrderDate = text(form, "releaseOrderDate");
    const releasedAt = text(form, "releasedAt");
    const caseStage = text(form, "caseStage") || "intake";
    const finalInvoiceTotalMinor =
      claim.finalInvoiceTotalMinor ??
      claim.finalInvoiceAmountMinor ??
      claim.claimAmountMinor ??
      0;

    if (
      finalInvoiceTotalMinor > 0 &&
      insurerResponsibilityMinor + customerResponsibilityMinor + writeOffMinor !==
        finalInvoiceTotalMinor
    ) {
      const difference =
        finalInvoiceTotalMinor -
        insurerResponsibilityMinor -
        customerResponsibilityMinor -
        writeOffMinor;
      notify(
        `Insurer, customer and authorised adjustment must equal the final invoice. Difference: ${formatMoney(Math.abs(difference))}.`,
        "error",
      );
      return;
    }

    if (insurerReceivedMinor > insurerResponsibilityMinor) {
      notify("Insurer cleared amount cannot exceed insurer responsibility", "error");
      return;
    }

    if (customerReceivedMinor > customerResponsibilityMinor) {
      notify("Customer cleared amount cannot exceed customer responsibility", "error");
      return;
    }

    if (releaseStatus === "release_order_verified" && (!releaseOrderNumber || !releaseOrderDate)) {
      notify("Add the release order reference and date before marking it verified", "error");
      return;
    }

    if (releaseStatus === "released") {
      const customerSettled = customerReceivedMinor === customerResponsibilityMinor;
      const insurerSettled = insurerReceivedMinor === insurerResponsibilityMinor;
      const releaseOrderRecorded = Boolean(releaseOrderNumber && releaseOrderDate);
      if (!releasedAt) {
        notify("Add the vehicle released date before marking it released", "error");
        return;
      }
      if (!customerSettled) {
        notify("The customer responsibility must be fully cleared before release", "error");
        return;
      }
      if (!insurerSettled && !releaseOrderRecorded) {
        notify("Record a verified release order or clear the insurer responsibility before release", "error");
        return;
      }
    }

    if (
      settlementStatus === "reconciled" &&
      (insurerReceivedMinor !== insurerResponsibilityMinor ||
        customerReceivedMinor !== customerResponsibilityMinor)
    ) {
      notify("Both insurer and customer responsibilities must be fully cleared before reconciliation", "error");
      return;
    }

    if (caseStage === "closed" && (releaseStatus !== "released" || settlementStatus !== "reconciled")) {
      notify("A case can close only after vehicle release and full reconciliation", "error");
      return;
    }

    try {
      setSaving(true);
      await updateDoc(doc(db, "insuranceClaims", id), {
        schemaVersion: 2,
        companyName: text(form, "companyName"),
        policyNumber: text(form, "policyNumber"),
        claimNumber: text(form, "claimNumber"),
        currency: "LKR",
        accidentDate: text(form, "accidentDate"),
        paymentRoute: text(form, "paymentRoute") || "insurer_direct",

        caseStage,
        approvalStatus,
        releaseStatus,
        settlementStatus,

        assessorName: text(form, "assessorName"),
        assessmentDate: text(form, "assessmentDate"),
        assessmentReference: text(form, "assessmentReference"),

        claimAmountMinor: toMinor(text(form, "claimAmount")),
        finalInvoiceAmountMinor: finalInvoiceTotalMinor,
        finalInvoiceTotalMinor,
        assessedAmountMinor: toMinor(text(form, "assessedAmount")),
        approvedAmountMinor: toMinor(text(form, "approvedAmount")),
        insurerResponsibilityMinor,
        customerResponsibilityMinor,
        insurerReceivedMinor,
        customerReceivedMinor,
        receivedAmountMinor: insurerReceivedMinor + customerReceivedMinor,
        writeOffMinor,

        releaseOrderNumber,
        releaseOrderDate,
        releasedAt,
        releasedByUid: releaseStatus === "released" ? uid : null,
        expectedSettlementDate: text(form, "expectedSettlementDate"),
        quantumEstablishedAt: text(form, "quantumEstablishedAt"),
        dischargeDocumentsReceivedAt: text(form, "dischargeDocumentsReceivedAt"),
        regulatorySettlementDate: text(form, "regulatorySettlementDate"),

        status: deriveLegacyStatus(approvalStatus, settlementStatus),
        notes: text(form, "notes"),
        archived: claim.archived ?? false,
        updatedByUid: uid,
        updatedAt: serverTimestamp(),
      });

      notify("Insurance case updated");
      router.push(`/dashboard/insurance/${id}`);
    } catch (error) {
      console.error("UPDATE INSURANCE CASE ERROR", error);
      notify("Could not update the insurance case", "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveSettlement(form: FormData) {
    const uid = auth.currentUser?.uid;
    if (!claim || !uid || !canRecordSettlement) {
      notify("Accounting settlement access is required", "error");
      return;
    }

    const settlementStatus = text(form, "settlementStatus") || "not_due";
    const insurerReceivedMinor = toMinor(text(form, "insurerReceived"));
    const customerReceivedMinor = toMinor(text(form, "customerReceived"));
    const insurerResponsibilityMinor = claim.insurerResponsibilityMinor ?? 0;
    const customerResponsibilityMinor = claim.customerResponsibilityMinor ?? 0;

    if (insurerReceivedMinor > insurerResponsibilityMinor) {
      notify("Insurer cleared amount cannot exceed insurer responsibility", "error");
      return;
    }
    if (customerReceivedMinor > customerResponsibilityMinor) {
      notify("Customer cleared amount cannot exceed customer responsibility", "error");
      return;
    }
    if (
      settlementStatus === "reconciled" &&
      (insurerReceivedMinor !== insurerResponsibilityMinor ||
        customerReceivedMinor !== customerResponsibilityMinor)
    ) {
      notify("Both insurer and customer responsibilities must be fully cleared before reconciliation", "error");
      return;
    }

    const insurerPaymentMethod = text(form, "insurerPaymentMethod");
    const isCheque = insurerPaymentMethod === "cheque";

    try {
      setSaving(true);
      await updateDoc(doc(db, "insuranceClaims", id), {
        settlementStatus,
        insurerReceivedMinor,
        customerReceivedMinor,
        receivedAmountMinor: insurerReceivedMinor + customerReceivedMinor,
        status: deriveLegacyStatus(claim.approvalStatus || "pending", settlementStatus),
        expectedSettlementDate: text(form, "expectedSettlementDate"),
        insurerPaymentMethod: insurerPaymentMethod || "other",
        insurerPaymentReference: text(form, "insurerPaymentReference"),
        customerPaymentReference: text(form, "customerPaymentReference"),
        chequeStatus: isCheque ? text(form, "chequeStatus") || "expected" : "not_applicable",
        chequeReceivedAt: isCheque
          ? timestampFromDateInput(text(form, "chequeReceivedAt"))
          : null,
        chequeClearedAt: isCheque
          ? timestampFromDateInput(text(form, "chequeClearedAt"))
          : null,
        settlementNotes: text(form, "settlementNotes"),
        updatedByUid: uid,
        updatedAt: serverTimestamp(),
      });

      notify("Settlement details updated");
      router.push(`/dashboard/insurance/${id}`);
    } catch (error) {
      console.error("UPDATE INSURANCE SETTLEMENT ERROR", error);
      notify("Could not update settlement details", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!roleResolved) {
    return <p className="p-6">Loading insurance case...</p>;
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Insurance workflow" title="Edit Insurance Case" icon={ShieldCheck} />
        <div className="card flex items-start gap-3 p-6">
          <AlertCircle size={20} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-ink">View-only access</p>
            <p className="mt-1 text-sm text-ink-soft">Only authorised insurance or accounting roles can update this case.</p>
            <Link href={`/dashboard/insurance/${id}`} className="btn-primary mt-4 inline-flex">Return to case</Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !claim) {
    return <p className="p-6">Loading insurance case...</p>;
  }

  if (claim.schemaVersion !== 2 || claim.id !== claim.jobCardId) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Insurance workflow" title="Legacy Insurance Record" icon={ShieldCheck} />
        <div className="card flex items-start gap-3 p-6">
          <AlertCircle size={20} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-ink">This earlier claim is read only</p>
            <p className="mt-1 text-sm text-ink-soft">
              It does not use the Job Card ID and v2 case schema required by the new Firestore rules. Its original values remain available on the case details page.
            </p>
            <Link href={`/dashboard/insurance/${id}`} className="btn-primary mt-4 inline-flex">Return to case</Link>
          </div>
        </div>
      </div>
    );
  }

  if (canRecordSettlement) {
    const settlementStatus =
      claim.settlementStatus || (claim.status === "received" ? "reconciled" : "not_due");
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader eyebrow="Insurance accounting" title="Record Claim Settlement" icon={WalletCards} />
        <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          This accounting view can record payments and settlement references only. General claim, approval and release details remain read only.
        </div>
        <form action={saveSettlement} className="card space-y-5 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-surface-muted p-4">
              <p className="text-xs text-ink-faint">Insurer responsibility</p>
              <p className="mt-1 font-semibold text-ink">LKR {moneyDefault(claim.insurerResponsibilityMinor) || "0.00"}</p>
            </div>
            <div className="rounded-xl bg-surface-muted p-4">
              <p className="text-xs text-ink-faint">Customer responsibility</p>
              <p className="mt-1 font-semibold text-ink">LKR {moneyDefault(claim.customerResponsibilityMinor) || "0.00"}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Settlement state">
              <select name="settlementStatus" className="input-luxe" defaultValue={settlementStatus}>
                {availableTransitions(settlementStatus, SETTLEMENT_TRANSITIONS).map((status) => (
                  <option key={status} value={status}>{SETTLEMENT_LABELS[status] ?? status}</option>
                ))}
              </select>
            </Field>
            <Field label="Expected insurer settlement date" hint="The case page calculates overdue reminders from this date.">
              <input name="expectedSettlementDate" type="date" className="input-luxe" defaultValue={dateDefault(claim.expectedSettlementDate)} />
            </Field>
            <MoneyField name="insurerReceived" label="Insurer cleared amount" value={claim.insurerReceivedMinor ?? claim.receivedAmountMinor} />
            <MoneyField name="customerReceived" label="Customer cleared amount" value={claim.customerReceivedMinor} />
            <Field label="Insurer payment method">
              <select name="insurerPaymentMethod" className="input-luxe" defaultValue={claim.insurerPaymentMethod || "bank_transfer"}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Insurer payment reference">
              <input name="insurerPaymentReference" className="input-luxe" defaultValue={claim.insurerPaymentReference ?? ""} />
            </Field>
            <Field label="Customer payment reference">
              <input name="customerPaymentReference" className="input-luxe" defaultValue={claim.customerPaymentReference ?? ""} />
            </Field>
            <Field label="Cheque state" hint="Used only when the insurer pays by cheque.">
              <select name="chequeStatus" className="input-luxe" defaultValue={claim.chequeStatus || "expected"}>
                <option value="expected">Expected</option>
                <option value="received">Received</option>
                <option value="deposited">Deposited</option>
                <option value="cleared">Cleared</option>
                <option value="bounced">Bounced</option>
                <option value="reversed">Reversed</option>
              </select>
            </Field>
            <Field label="Cheque received date" hint="Used only for cheque payments.">
              <input name="chequeReceivedAt" type="date" className="input-luxe" defaultValue={dateDefault(claim.chequeReceivedAt)} />
            </Field>
            <Field label="Cheque cleared date" hint="Only a cleared cheque should increase the cleared amount.">
              <input name="chequeClearedAt" type="date" className="input-luxe" defaultValue={dateDefault(claim.chequeClearedAt)} />
            </Field>
          </div>

          <Field label="Settlement notes">
            <textarea name="settlementNotes" className="input-luxe" rows={4} defaultValue={claim.settlementNotes ?? ""} placeholder="Record transfer, cheque or reconciliation details." />
          </Field>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Link href={`/dashboard/insurance/${id}`} className="btn-ghost text-center">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving settlement..." : "Save settlement"}</button>
          </div>
        </form>
      </div>
    );
  }

  const finalInvoiceMinor =
    claim.finalInvoiceTotalMinor ??
    claim.finalInvoiceAmountMinor ??
    claim.claimAmountMinor ??
    0;
  const approvedFallback = claim.approvedAmountMinor ?? claim.claimAmountMinor;
  const insurerResponsibilityFallback =
    claim.insurerResponsibilityMinor ?? approvedFallback;
  const insurerReceivedFallback =
    claim.insurerReceivedMinor ?? claim.receivedAmountMinor;
  const currentCaseStage = legacyStage(claim);
  const currentApprovalStatus =
    claim.approvalStatus ||
    (claim.status === "approved"
      ? "approved"
      : claim.status === "rejected"
        ? "rejected"
        : "pending");
  const currentReleaseStatus = claim.releaseStatus || "blocked";
  const currentSettlementStatus =
    claim.settlementStatus || (claim.status === "received" ? "reconciled" : "not_due");

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Insurance workflow" title="Edit Insurance Case" icon={ShieldCheck} />

      <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        Money fields are shown and entered in LKR. Belt-Kit converts them to minor units only when saving.
      </div>

      <form action={save} className="space-y-6">
        <EditSection number="1" icon={ShieldCheck} title="Intake and policy details">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Insurance company" required>
              <input name="companyName" className="input-luxe" defaultValue={claim.companyName} required />
            </Field>
            <Field label="Policy number">
              <input name="policyNumber" className="input-luxe" defaultValue={claim.policyNumber ?? ""} />
            </Field>
            <Field label="Claim number">
              <input name="claimNumber" className="input-luxe" defaultValue={claim.claimNumber ?? ""} />
            </Field>
            <Field label="Accident date">
              <input name="accidentDate" type="date" className="input-luxe" defaultValue={dateDefault(claim.accidentDate)} />
            </Field>
            <Field label="Current case stage">
              <select name="caseStage" className="input-luxe" defaultValue={currentCaseStage}>
                {availableTransitions(currentCaseStage, CASE_STAGE_TRANSITIONS).map((stage) => (
                  <option key={stage} value={stage}>{CASE_STAGE_LABELS[stage] ?? stage}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-faint">Only the current stage and valid next or previous workflow steps are shown.</p>
            </Field>
            <Field label="Payment route">
              <select name="paymentRoute" className="input-luxe" defaultValue={claim.paymentRoute || "insurer_direct"}>
                <option value="insurer_direct">Insurer pays garage</option>
                <option value="customer_direct">Customer pays garage</option>
                <option value="split">Insurer and customer split</option>
              </select>
            </Field>
          </div>
        </EditSection>

        <EditSection number="2" icon={FileText} title="Documents">
          <div className="grid gap-3 md:grid-cols-2">
            {DOCUMENTS.map((documentName) => (
              <div key={documentName} className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line bg-surface-muted/40 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText size={18} className="shrink-0 text-burgundy-600" />
                  <div>
                    <p className="text-sm font-medium text-ink">{documentName}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">Upload connection planned for a later update</p>
                  </div>
                </div>
                <button type="button" className="btn-ghost shrink-0 opacity-60" disabled title="Upload logic is not enabled yet"><UploadCloud size={15} /></button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-faint">Document upload will be connected in a later update.</p>
        </EditSection>

        <EditSection number="3" icon={ClipboardCheck} title="Assessment">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Assessor name">
              <input name="assessorName" className="input-luxe" defaultValue={claim.assessorName ?? ""} />
            </Field>
            <Field label="Assessment date">
              <input name="assessmentDate" type="date" className="input-luxe" defaultValue={dateDefault(claim.assessmentDate)} />
            </Field>
            <Field label="Assessment reference">
              <input name="assessmentReference" className="input-luxe" defaultValue={claim.assessmentReference ?? ""} />
            </Field>
            <MoneyField name="claimAmount" label="Workshop claim amount" value={claim.claimAmountMinor} />
            <MoneyField name="assessedAmount" label="Assessor amount" value={claim.assessedAmountMinor} />
            <MoneyField name="approvedAmount" label="Approved amount" value={approvedFallback} />
          </div>
        </EditSection>

        <EditSection number="4" icon={Landmark} title="Approval and responsibility">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Approval state">
              <select name="approvalStatus" className="input-luxe" defaultValue={currentApprovalStatus}>
                {availableTransitions(currentApprovalStatus, APPROVAL_TRANSITIONS).map((status) => (
                  <option key={status} value={status}>{APPROVAL_LABELS[status] ?? status}</option>
                ))}
              </select>
            </Field>
            <MoneyField name="insurerResponsibility" label="Insurer responsibility" value={insurerResponsibilityFallback} />
            <MoneyField name="customerResponsibility" label="Customer responsibility" value={claim.customerResponsibilityMinor} />
            <div className="rounded-xl bg-surface-muted p-4">
              <p className="text-xs text-ink-faint">Frozen final invoice</p>
              <p className="mt-1 font-semibold text-ink">LKR {moneyDefault(finalInvoiceMinor) || "0.00"}</p>
              <p className="mt-1 text-xs text-ink-faint">Read-only; sourced from the delivered Job Card.</p>
            </div>
          </div>
        </EditSection>

        <EditSection number="5" icon={ReceiptText} title="Release control and due dates">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Release state">
              <select name="releaseStatus" className="input-luxe" defaultValue={currentReleaseStatus}>
                {availableTransitions(currentReleaseStatus, RELEASE_TRANSITIONS).map((status) => (
                  <option key={status} value={status}>{RELEASE_LABELS[status] ?? status}</option>
                ))}
              </select>
            </Field>
            <Field label="Release order / undertaking reference">
              <input name="releaseOrderNumber" className="input-luxe" defaultValue={claim.releaseOrderNumber ?? ""} />
            </Field>
            <Field label="Release order date">
              <input name="releaseOrderDate" type="date" className="input-luxe" defaultValue={dateDefault(claim.releaseOrderDate)} />
            </Field>
            <Field label="Vehicle released date">
              <input name="releasedAt" type="date" className="input-luxe" defaultValue={dateDefault(claim.releasedAt)} />
            </Field>
            <Field label="Expected insurer settlement date" hint="Used for live client-side overdue reminders.">
              <input name="expectedSettlementDate" type="date" className="input-luxe" defaultValue={dateDefault(claim.expectedSettlementDate)} />
            </Field>
            <Field label="Quantum established date">
              <input name="quantumEstablishedAt" type="date" className="input-luxe" defaultValue={dateDefault(claim.quantumEstablishedAt)} />
            </Field>
            <Field label="Discharge documents received date">
              <input name="dischargeDocumentsReceivedAt" type="date" className="input-luxe" defaultValue={dateDefault(claim.dischargeDocumentsReceivedAt)} />
            </Field>
            <Field label="Regulatory settlement date" hint="Record the applicable due date after checking the insurer requirements.">
              <input name="regulatorySettlementDate" type="date" className="input-luxe" defaultValue={dateDefault(claim.regulatorySettlementDate)} />
            </Field>
          </div>
        </EditSection>

        <EditSection number="6" icon={WalletCards} title="Settlement and reconciliation">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Settlement state">
              <select name="settlementStatus" className="input-luxe" defaultValue={currentSettlementStatus}>
                {availableTransitions(currentSettlementStatus, SETTLEMENT_TRANSITIONS).map((status) => (
                  <option key={status} value={status}>{SETTLEMENT_LABELS[status] ?? status}</option>
                ))}
              </select>
            </Field>
            <MoneyField name="insurerReceived" label="Insurer cleared amount" value={insurerReceivedFallback} />
            <MoneyField name="customerReceived" label="Customer cleared amount" value={claim.customerReceivedMinor} />
            <MoneyField name="writeOff" label="Authorised adjustment" value={claim.writeOffMinor} />
          </div>
          <div className="mt-4">
            <Field label="Case notes">
              <textarea name="notes" className="input-luxe" rows={4} defaultValue={claim.notes ?? ""} />
            </Field>
          </div>
        </EditSection>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Link href={`/dashboard/insurance/${id}`} className="btn-ghost text-center">Cancel</Link>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving changes..." : "Save case changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditSection({ number, icon: Icon, title, children }: { number: string; icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-3 border-b border-line pb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-burgundy-50 text-burgundy-600"><Icon size={18} /></div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Stage {number} of 6</p>
          <h2 className="font-semibold text-ink">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function MoneyField({ name, label, value }: { name: string; label: string; value?: number | null }) {
  return (
    <Field label={`${label} (LKR)`}>
      <input
        name={name}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        className="input-luxe"
        defaultValue={moneyDefault(value)}
      />
    </Field>
  );
}
