"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import {
  AlertCircle,
  CheckCircle2,
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
import { Customer, JobCard, Vehicle } from "@/lib/models";
import { insuranceClaimDocumentId } from "@/lib/workflow-rules";

type CaseStage =
  | "intake"
  | "documents"
  | "assessment"
  | "approval"
  | "release"
  | "settlement";

const CASE_STAGES: Array<{ value: CaseStage; label: string }> = [
  { value: "intake", label: "Intake" },
  { value: "documents", label: "Documents" },
  { value: "assessment", label: "Assessment" },
  { value: "approval", label: "Approval" },
  { value: "release", label: "Release" },
  { value: "settlement", label: "Settlement" },
];

const DOCUMENT_PLACEHOLDERS = [
  "Claim form and accident report",
  "Customer payment authorisation",
  "Assessor estimate / settlement advice",
  "Parts quotations and revised estimates",
  "Release order or payment undertaking",
];

function text(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function deriveLegacyStatus(
  approvalStatus: string,
  settlementStatus: string,
) {
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

export default function CreateInsurancePage() {
  const router = useRouter();
  const params = useSearchParams();
  const jobId = params.get("jobId");
  const { notify } = useToast();
  const { role, roleResolved } = useAuth();
  const canCreate = role === "owner" || role === "manager" || role === "advisor";

  const [job, setJob] = useState<JobCard | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [existingClaimId, setExistingClaimId] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      if (!roleResolved) return;
      if (!canCreate) {
        if (active) setLoading(false);
        return;
      }

      if (!jobId) {
        if (active) {
          setProblem("Choose a delivered Job Card before creating an insurance case.");
          setLoading(false);
        }
        return;
      }

      try {
        const [jobSnap, claimSnap, claimsForJobSnap] = await Promise.all([
          getDoc(doc(db, "jobCards", jobId)),
          getDoc(doc(db, "insuranceClaims", jobId)),
          getDocs(
            query(
              collection(db, "insuranceClaims"),
              where("jobCardId", "==", jobId),
              limit(1),
            ),
          ),
        ]);

        if (!active) return;

        if (!jobSnap.exists()) {
          setProblem("The selected Job Card could not be found.");
          return;
        }

        const loadedJob = {
          id: jobSnap.id,
          ...jobSnap.data(),
        } as unknown as JobCard;

        if (loadedJob.status !== "delivered") {
          setProblem(
            "Insurance cases can only be created from delivered Job Cards. Complete and deliver this job first.",
          );
          return;
        }

        const matchingClaim = claimSnap.exists()
          ? claimSnap
          : claimsForJobSnap.docs[0];

        if (matchingClaim) {
          setExistingClaimId(matchingClaim.id);
          setProblem(
            matchingClaim.id === jobId
              ? "An insurance case already exists for this Job Card. Each new case uses its Job Card ID."
              : "A legacy insurance claim already exists for this Job Card. It remains available as a read-only record, so another case cannot be created.",
          );
          return;
        }

        setJob(loadedJob);

        const [customerSnap, vehicleSnap] = await Promise.all([
          getDoc(doc(db, "customers", loadedJob.customerId)),
          getDoc(doc(db, "vehicles", loadedJob.vehicleId)),
        ]);

        if (!active) return;

        if (customerSnap.exists()) {
          setCustomer({
            id: customerSnap.id,
            ...customerSnap.data(),
          } as unknown as Customer);
        }

        if (vehicleSnap.exists()) {
          setVehicle({
            id: vehicleSnap.id,
            ...vehicleSnap.data(),
          } as unknown as Vehicle);
        }
      } catch (error) {
        console.error("LOAD INSURANCE INTAKE ERROR", error);
        if (active) setProblem("The insurance intake could not be loaded. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [canCreate, jobId, roleResolved]);

  async function save(form: FormData) {
    const linkedJobId = job?.id || jobId;
    const uid = auth.currentUser?.uid;

    if (!job || !linkedJobId || job.status !== "delivered" || !canCreate) {
      notify("A delivered Job Card is required", "error");
      return;
    }

    if (!uid) {
      notify("Sign in before creating an insurance case", "error");
      return;
    }

    const claimId = insuranceClaimDocumentId(linkedJobId);

    const approvalStatus = text(form, "approvalStatus") || "pending";
    const releaseStatus = text(form, "releaseStatus") || "blocked";
    const settlementStatus = text(form, "settlementStatus") || "not_due";
    const insurerReceivedMinor = toMinor(text(form, "insurerReceived"));
    const customerReceivedMinor = toMinor(text(form, "customerReceived"));
    const insurerResponsibilityMinor = toMinor(text(form, "insurerResponsibility"));
    const customerResponsibilityMinor = toMinor(text(form, "customerResponsibility"));
    const finalInvoiceTotalMinor = job.totalMinor ?? 0;
    const releaseOrderNumber = text(form, "releaseOrderNumber");
    const releaseOrderDate = text(form, "releaseOrderDate");
    const releasedAt = text(form, "releasedAt");
    const caseStage = (text(form, "caseStage") || "intake") as CaseStage;
    const claimRef = doc(db, "insuranceClaims", claimId);

    if (
      finalInvoiceTotalMinor > 0 &&
      insurerResponsibilityMinor + customerResponsibilityMinor !== finalInvoiceTotalMinor
    ) {
      const difference =
        finalInvoiceTotalMinor -
        insurerResponsibilityMinor -
        customerResponsibilityMinor;
      notify(
        `Insurer and customer responsibility must equal the final invoice. Difference: ${formatMoney(Math.abs(difference))}.`,
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
      if (!releasedAt) {
        notify("Add the vehicle released date before marking it released", "error");
        return;
      }
      if (!customerSettled) {
        notify("The customer responsibility must be fully cleared before release", "error");
        return;
      }
      if (!insurerSettled && !(releaseOrderNumber && releaseOrderDate)) {
        notify("Record a release order or clear the insurer responsibility before release", "error");
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

    try {
      setSaving(true);

      // A simple read-before-create gives immediate feedback. Firestore rules also
      // enforce one claim per delivered Job Card by requiring claimId == jobCardId.
      const [existing, matchingClaims] = await Promise.all([
        getDoc(claimRef),
        getDocs(
          query(
            collection(db, "insuranceClaims"),
            where("jobCardId", "==", claimId),
            limit(1),
          ),
        ),
      ]);
      const matchingClaim = existing.exists() ? existing : matchingClaims.docs[0];
      if (matchingClaim) {
        setExistingClaimId(matchingClaim.id);
        setProblem("An insurance case already exists for this Job Card.");
        notify("Insurance case already exists", "error");
        return;
      }

      await setDoc(claimRef, {
        schemaVersion: 2,
        branchId: job.branchId,
        jobCardId: claimId,
        customerId: job.customerId,
        vehicleId: job.vehicleId,
        invoiceId: job.invoiceId ?? null,
        finalInvoiceId: job.invoiceId ?? null,

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

        finalInvoiceAmountMinor: finalInvoiceTotalMinor,
        finalInvoiceTotalMinor,
        claimAmountMinor: toMinor(text(form, "claimAmount")),
        assessedAmountMinor: toMinor(text(form, "assessedAmount")),
        approvedAmountMinor: toMinor(text(form, "approvedAmount")),
        insurerResponsibilityMinor,
        customerResponsibilityMinor,
        insurerReceivedMinor,
        customerReceivedMinor,
        receivedAmountMinor: insurerReceivedMinor + customerReceivedMinor,
        writeOffMinor: 0,

        releaseOrderNumber,
        releaseOrderDate,
        expectedSettlementDate: text(form, "expectedSettlementDate"),
        releasedAt,
        releasedByUid: releaseStatus === "released" ? uid : null,

        status: deriveLegacyStatus(approvalStatus, settlementStatus),
        documentStatus: "not_started",
        documentCount: 0,
        verifiedDocumentCount: 0,
        notes: text(form, "notes"),
        archived: false,
        createdByUid: uid,
        updatedByUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      notify("Insurance case created");
      router.push(`/dashboard/insurance/${claimId}`);
    } catch (error) {
      console.error("CREATE INSURANCE CASE ERROR", error);
      notify("Could not save the insurance case", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !roleResolved) {
    return <p className="p-6">Loading insurance intake...</p>;
  }

  if (!canCreate) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Finance" title="New Insurance Case" icon={ShieldCheck} />
        <div className="card flex items-start gap-3 p-6">
          <AlertCircle size={20} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-ink">View-only insurance access</p>
            <p className="mt-1 text-sm text-ink-soft">Only an owner, manager or advisor can create an insurance case.</p>
            <Link href="/dashboard/insurance" className="btn-primary mt-4 inline-flex">Return to insurance</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!job || problem) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Finance" title="New Insurance Case" icon={ShieldCheck} />
        <div className="card p-6">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <AlertCircle className="mt-0.5 shrink-0" size={20} />
            <div>
              <p className="font-semibold">Insurance intake is not available</p>
              <p className="mt-1 text-sm">{problem}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {existingClaimId && (
                  <Link
                    href={`/dashboard/insurance/${existingClaimId}`}
                    className="btn-primary"
                  >
                    Open existing case
                  </Link>
                )}
                <Link href="/dashboard/job-cards/finished-jobs" className="btn-ghost">
                  View delivered jobs
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const invoiceMajor = ((job.totalMinor ?? 0) / 100).toFixed(2);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Insurance workflow" title="New Insurance Case" icon={ShieldCheck} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Customer" value={customer?.displayName ?? "Not available"} />
        <Summary
          label="Vehicle"
          value={
            vehicle
              ? `${vehicle.make} ${vehicle.model} · ${vehicle.plateNumber}`
              : "Not available"
          }
        />
        <Summary label="Job Card" value={job.complaint || job.id || "Delivered job"} />
        <Summary label="Final invoice" value={`LKR ${invoiceMajor}`} />
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
        <CheckCircle2 className="mt-0.5 shrink-0" size={19} />
        <div>
          <p className="font-semibold">Delivered Job Card confirmed</p>
          <p className="mt-1 text-sm">
            Belt-Kit currently creates insurance cases only from delivered jobs. This case ID
            will be the Job Card ID: <span className="font-mono">{job.id}</span>.
          </p>
        </div>
      </div>

      <form action={save} className="space-y-6">
        <Section number="1" icon={ShieldCheck} title="Intake and policy details" description="Identify the insurer, policy, accident and payment route.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Insurance company" required>
              <input name="companyName" className="input-luxe" required />
            </Field>
            <Field label="Policy number">
              <input name="policyNumber" className="input-luxe" />
            </Field>
            <Field label="Claim number">
              <input name="claimNumber" className="input-luxe" />
            </Field>
            <Field label="Accident date">
              <input name="accidentDate" type="date" className="input-luxe" />
            </Field>
            <Field label="Current case stage">
              <select name="caseStage" className="input-luxe" defaultValue="intake">
                {CASE_STAGES.map((stage) => (
                  <option key={stage.value} value={stage.value}>{stage.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Payment route">
              <select name="paymentRoute" className="input-luxe" defaultValue="insurer_direct">
                <option value="insurer_direct">Insurer pays garage</option>
                <option value="customer_direct">Customer pays garage</option>
                <option value="split">Insurer and customer split</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section number="2" icon={FileText} title="Documents" description="A clear holding area for claim documents. Upload storage will be connected in a later update.">
          <div className="grid gap-3 md:grid-cols-2">
            {DOCUMENT_PLACEHOLDERS.map((label) => (
              <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line bg-surface-muted/40 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText size={18} className="shrink-0 text-burgundy-600" />
                  <div>
                    <p className="text-sm font-medium text-ink">{label}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">No document connected yet</p>
                  </div>
                </div>
                <button type="button" disabled className="btn-ghost shrink-0 opacity-60" title="Document upload will be enabled later">
                  <UploadCloud size={15} />
                  <span className="sr-only">Upload later</span>
                </button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            Document upload will be connected in a later update.
          </p>
        </Section>

        <Section number="3" icon={ClipboardCheck} title="Assessment" description="Record the assessor and compare the workshop request with the assessed amount.">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Assessor name">
              <input name="assessorName" className="input-luxe" />
            </Field>
            <Field label="Assessment date">
              <input name="assessmentDate" type="date" className="input-luxe" />
            </Field>
            <Field label="Assessment reference">
              <input name="assessmentReference" className="input-luxe" />
            </Field>
            <MoneyField name="claimAmount" label="Workshop claim amount" defaultValue={invoiceMajor} />
            <MoneyField name="assessedAmount" label="Assessor amount" />
            <MoneyField name="approvedAmount" label="Approved amount" />
          </div>
        </Section>

        <Section number="4" icon={Landmark} title="Approval and responsibility" description="Separate the insurer portion from excess, deductions or other customer responsibility.">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Approval state">
              <select name="approvalStatus" className="input-luxe" defaultValue="pending">
                <option value="pending">Pending</option>
                <option value="partly_approved">Partly approved</option>
                <option value="approved">Approved</option>
                <option value="disputed">Disputed</option>
                <option value="rejected">Rejected</option>
              </select>
            </Field>
            <MoneyField name="insurerResponsibility" label="Insurer responsibility" defaultValue={invoiceMajor} />
            <MoneyField name="customerResponsibility" label="Customer responsibility" defaultValue="0.00" />
          </div>
        </Section>

        <Section number="5" icon={ReceiptText} title="Release control" description="A release order is authority to release; it is not a cleared payment.">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Release state">
              <select name="releaseStatus" className="input-luxe" defaultValue="blocked">
                <option value="blocked">Blocked</option>
                <option value="eligible">Eligible for release</option>
                <option value="release_order_verified">Release order verified</option>
                <option value="released">Vehicle released</option>
              </select>
            </Field>
            <Field label="Release order / undertaking reference">
              <input name="releaseOrderNumber" className="input-luxe" />
            </Field>
            <Field label="Release order date">
              <input name="releaseOrderDate" type="date" className="input-luxe" />
            </Field>
            <Field label="Vehicle released date">
              <input name="releasedAt" type="date" className="input-luxe" />
            </Field>
            <Field label="Expected insurer settlement date" hint="Used to calculate reminders and overdue days.">
              <input name="expectedSettlementDate" type="date" className="input-luxe" />
            </Field>
          </div>
        </Section>

        <Section number="6" icon={WalletCards} title="Settlement" description="Track insurer and customer money separately. Only cleared amounts belong here.">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Settlement state">
              <select name="settlementStatus" className="input-luxe" defaultValue="not_due">
                <option value="not_due">Not due</option>
                <option value="insurer_pending">Insurer payment pending</option>
                <option value="customer_pending">Customer payment pending</option>
                <option value="part_paid">Part paid</option>
                <option value="reconciled">Reconciled and closed</option>
              </select>
            </Field>
            <MoneyField name="insurerReceived" label="Insurer cleared amount" defaultValue="0.00" />
            <MoneyField name="customerReceived" label="Customer cleared amount" defaultValue="0.00" />
          </div>
          <div className="mt-4">
            <Field label="Case notes">
              <textarea name="notes" className="input-luxe" rows={4} placeholder="Record deductions, supplementary quotation needs, release conditions or settlement notes." />
            </Field>
          </div>
        </Section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Link href="/dashboard/insurance" className="btn-ghost text-center">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Creating case..." : "Create insurance case"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
    </div>
  );
}

function Section({
  number,
  icon: Icon,
  title,
  description,
  children,
}: {
  number: string;
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3 border-b border-line pb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-burgundy-50 text-burgundy-600">
          <Icon size={18} />
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Stage {number} of 6</p>
          <h2 className="font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-sm text-ink-soft">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function MoneyField({
  name,
  label,
  defaultValue = "",
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <Field label={`${label} (LKR)`}>
      <input
        name={name}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        className="input-luxe"
        defaultValue={defaultValue}
      />
    </Field>
  );
}
