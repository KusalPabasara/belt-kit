"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  Car,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Landmark,
  Pencil,
  ReceiptText,
  ShieldCheck,
  User,
  WalletCards,
} from "lucide-react";

import { Badge, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/firebase";
import { formatMoney } from "@/lib/format";
import { Customer, InsuranceClaim, JobCard, Vehicle } from "@/lib/models";

type CaseStage =
  | "intake"
  | "documents"
  | "assessment"
  | "approval"
  | "release"
  | "settlement";

type DateLike =
  | string
  | Date
  | { toDate?: () => Date; seconds?: number }
  | null
  | undefined;

type InsuranceCase = InsuranceClaim & {
  schemaVersion?: number;
  caseStage?: CaseStage;
  approvalStatus?: string;
  releaseStatus?: string;
  settlementStatus?: string;
  accidentDate?: DateLike;
  paymentRoute?: string;
  assessorName?: string;
  assessmentDate?: DateLike;
  assessmentReference?: string;
  finalInvoiceId?: string | null;
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
  updatedAt?: DateLike;
};

const STAGES: Array<{
  value: CaseStage;
  label: string;
  description: string;
}> = [
  { value: "intake", label: "Intake", description: "Case and policy recorded" },
  { value: "documents", label: "Documents", description: "Claim evidence collected" },
  { value: "assessment", label: "Assessment", description: "Damage and costs assessed" },
  { value: "approval", label: "Approval", description: "Liability decision recorded" },
  { value: "release", label: "Release", description: "Vehicle release controlled" },
  { value: "settlement", label: "Settlement", description: "Payments reconciled" },
];

const DOCUMENTS = [
  "Claim form and accident report",
  "Customer payment authorisation",
  "Assessor estimate / settlement advice",
  "Parts quotation or revised estimate",
  "Release order / payment undertaking",
];

function valueOr(value: number | null | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asDate(value: DateLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  return null;
}

function dateLabel(value: DateLike) {
  const date = asDate(value);
  if (!date) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function label(value?: string | null) {
  if (!value) return "Not recorded";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function resolvedStage(claim: InsuranceCase): CaseStage {
  if (claim.caseStage && STAGES.some((stage) => stage.value === claim.caseStage)) {
    return claim.caseStage;
  }
  if (claim.status === "received") return "settlement";
  if (claim.status === "approved" || claim.status === "rejected") return "approval";
  return "intake";
}

function badgeTone(status: string): "neutral" | "green" | "amber" | "blue" | "burgundy" {
  if (["reconciled", "approved", "released", "received"].includes(status)) return "green";
  if (["rejected", "blocked", "disputed"].includes(status)) return "burgundy";
  if (["partly_approved", "part_paid", "release_order_verified"].includes(status)) return "blue";
  return status ? "amber" : "neutral";
}

export default function InsuranceDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { role, roleResolved } = useAuth();
  const canView = role === "owner" || role === "manager" || role === "advisor" || role === "accountant";
  const canEdit = role === "owner" || role === "manager" || role === "advisor";
  const canRecordSettlement = role === "accountant";

  const [claim, setClaim] = useState<InsuranceCase | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [job, setJob] = useState<JobCard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!roleResolved) return;
      if (!canView) {
        if (active) setLoading(false);
        return;
      }

      try {
        const claimSnap = await getDoc(doc(db, "insuranceClaims", id));
        if (!claimSnap.exists()) {
          router.push("/dashboard/insurance");
          return;
        }

        const loadedClaim = {
          id: claimSnap.id,
          ...claimSnap.data(),
        } as unknown as InsuranceCase;

        const [customerSnap, vehicleSnap, jobSnap] = await Promise.all([
          getDoc(doc(db, "customers", loadedClaim.customerId)),
          getDoc(doc(db, "vehicles", loadedClaim.vehicleId)),
          getDoc(doc(db, "jobCards", loadedClaim.jobCardId)),
        ]);

        if (!active) return;
        setClaim(loadedClaim);

        if (customerSnap.exists()) {
          setCustomer({ id: customerSnap.id, ...customerSnap.data() } as unknown as Customer);
        }
        if (vehicleSnap.exists()) {
          setVehicle({ id: vehicleSnap.id, ...vehicleSnap.data() } as unknown as Vehicle);
        }
        if (jobSnap.exists()) {
          setJob({ id: jobSnap.id, ...jobSnap.data() } as unknown as JobCard);
        }
      } catch (error) {
        console.error("LOAD INSURANCE CASE ERROR", error);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [canView, id, roleResolved, router]);

  const finance = useMemo(() => {
    if (!claim) return null;

    const finalInvoice = valueOr(
      claim.finalInvoiceTotalMinor,
      valueOr(
        claim.finalInvoiceAmountMinor,
        valueOr(job?.totalMinor, valueOr(claim.claimAmountMinor)),
      ),
    );
    const assessed = valueOr(claim.assessedAmountMinor);
    const approved = valueOr(claim.approvedAmountMinor, valueOr(claim.claimAmountMinor));
    const insurerResponsibility = valueOr(
      claim.insurerResponsibilityMinor,
      approved || valueOr(claim.claimAmountMinor),
    );
    const customerResponsibility = valueOr(
      claim.customerResponsibilityMinor,
      Math.max(0, finalInvoice - insurerResponsibility),
    );
    const insurerReceived = valueOr(
      claim.insurerReceivedMinor,
      valueOr(claim.receivedAmountMinor),
    );
    const customerReceived = valueOr(claim.customerReceivedMinor);
    const writeOff = valueOr(claim.writeOffMinor);

    return {
      finalInvoice,
      assessed,
      approved,
      insurerResponsibility,
      customerResponsibility,
      insurerReceived,
      customerReceived,
      writeOff,
      insurerOutstanding: Math.max(0, insurerResponsibility - insurerReceived),
      customerOutstanding: Math.max(0, customerResponsibility - customerReceived),
      allocationDifference:
        finalInvoice - insurerResponsibility - customerResponsibility - writeOff,
    };
  }, [claim, job]);

  if (!roleResolved) {
    return <p className="p-6">Loading insurance case...</p>;
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Insurance workflow" title="Insurance Case" icon={ShieldCheck} />
        <div className="card flex items-start gap-3 p-6">
          <AlertCircle size={20} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-ink">Insurance access required</p>
            <p className="mt-1 text-sm text-ink-soft">This case is available only to authorised insurance and accounting roles.</p>
            <Link href="/dashboard" className="btn-primary mt-4 inline-flex">Return to dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !claim || !finance) {
    return <p className="p-6">Loading insurance case...</p>;
  }

  const currentStage = resolvedStage(claim);
  const isLegacyCase = claim.schemaVersion !== 2 || claim.id !== claim.jobCardId;
  const currentStageIndex = STAGES.findIndex((stage) => stage.value === currentStage);
  const expectedDate = asDate(claim.expectedSettlementDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (expectedDate) expectedDate.setHours(0, 0, 0, 0);
  const dayDifference = expectedDate
    ? Math.round((today.getTime() - expectedDate.getTime()) / 86_400_000)
    : null;
  const isReconciled =
    claim.settlementStatus === "reconciled" ||
    ((finance.insurerResponsibility > 0 || finance.customerResponsibility > 0) &&
      finance.insurerOutstanding === 0 &&
      finance.customerOutstanding === 0);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Insurance case workspace"
        title={claim.claimNumber ? `Claim ${claim.claimNumber}` : `Case ${claim.id}`}
        icon={ShieldCheck}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/insurance" className="btn-ghost flex items-center gap-2">
              <ArrowLeft size={15} /> Back
            </Link>
            {job && (
              <Link href={`/dashboard/job-cards/${claim.jobCardId}`} className="btn-ghost flex items-center gap-2">
                <ExternalLink size={15} /> Job Card
              </Link>
            )}
            {canEdit && !isLegacyCase && (
              <Link href={`/dashboard/insurance/${id}/edit`} className="btn-primary flex items-center gap-2">
                <Pencil size={15} /> Edit case
              </Link>
            )}
            {canRecordSettlement && !isLegacyCase && (
              <Link href={`/dashboard/insurance/${id}/edit`} className="btn-primary flex items-center gap-2">
                <WalletCards size={15} /> Record settlement
              </Link>
            )}
          </div>
        }
      />

      {isLegacyCase && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <AlertCircle size={19} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Legacy insurance record · read only</p>
            <p className="mt-1 text-sm">
              This earlier claim remains visible for reference, but it does not use the Job Card ID and v2 case schema required by the new Firestore rules. It cannot be edited from this workspace.
            </p>
          </div>
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="card p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm text-ink-faint">Insurance company</p>
              <h2 className="mt-1 text-xl font-semibold text-ink">{claim.companyName}</h2>
              <p className="mt-2 text-sm text-ink-soft">
                Policy {claim.policyNumber || "not recorded"} · Accident {dateLabel(claim.accidentDate)}
              </p>
            </div>
            <Badge tone={badgeTone(claim.settlementStatus || claim.status)}>
              {label(claim.settlementStatus || claim.status)}
            </Badge>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <StatusBox title="Approval" value={label(claim.approvalStatus || claim.status)} />
            <StatusBox title="Release" value={label(claim.releaseStatus || "blocked")} />
            <StatusBox title="Payment route" value={label(claim.paymentRoute || "insurer_direct")} />
          </div>
        </div>

        <Reminder
          expectedDate={claim.expectedSettlementDate}
          dayDifference={dayDifference}
          reconciled={isReconciled}
          insurerOutstanding={finance.insurerOutstanding}
        />
      </div>

      <section className="card mb-6 p-5 sm:p-6">
        <div className="mb-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Case progress</p>
          <h2 className="mt-1 font-semibold text-ink">Six-stage insurance workflow</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {STAGES.map((stage, index) => {
            const complete = index < currentStageIndex;
            const active = index === currentStageIndex;
            return (
              <div
                key={stage.value}
                className={`rounded-xl border p-4 ${
                  active
                    ? "border-burgundy-300 bg-burgundy-50"
                    : complete
                      ? "border-emerald-200 bg-emerald-50/60"
                      : "border-line bg-white"
                }`}
              >
                <div className={`mb-3 flex h-7 w-7 items-center justify-center rounded-full ${complete ? "bg-emerald-600 text-white" : active ? "bg-burgundy-600 text-white" : "bg-surface-muted text-ink-faint"}`}>
                  {complete ? <Check size={15} /> : active ? <Circle size={12} fill="currentColor" /> : index + 1}
                </div>
                <p className="text-sm font-semibold text-ink">{stage.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-faint">{stage.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <section className="card p-5 sm:p-6">
            <SectionHeading icon={WalletCards} title="Financial summary" subtitle="Insurer and customer obligations remain separate until cleared." />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MoneyBox label="Final invoice" value={finance.finalInvoice} strong />
              <MoneyBox label="Assessed amount" value={finance.assessed} />
              <MoneyBox label="Approved amount" value={finance.approved} />
              <MoneyBox label="Insurer responsibility" value={finance.insurerResponsibility} />
              <MoneyBox label="Insurer cleared" value={finance.insurerReceived} />
              <MoneyBox label="Insurer outstanding" value={finance.insurerOutstanding} warning={finance.insurerOutstanding > 0} />
              <MoneyBox label="Customer responsibility" value={finance.customerResponsibility} />
              <MoneyBox label="Customer cleared" value={finance.customerReceived} />
              <MoneyBox label="Customer outstanding" value={finance.customerOutstanding} warning={finance.customerOutstanding > 0} />
            </div>

            {finance.allocationDifference !== 0 && (
              <div className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <p>
                  The invoice allocation differs by {formatMoney(Math.abs(finance.allocationDifference))}.
                  Review the insurer portion, customer portion or authorised adjustment before reconciliation.
                </p>
              </div>
            )}
          </section>

          <section className="card p-5 sm:p-6">
            <SectionHeading icon={FileText} title="Document checklist" subtitle="Document upload connections will be enabled in a later update." />
            <div className="grid gap-3 sm:grid-cols-2">
              {DOCUMENTS.map((documentName) => (
                <div key={documentName} className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface-muted/40 p-4">
                  <FileText size={18} className="shrink-0 text-burgundy-600" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{documentName}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">Document connection pending</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="card p-5 sm:p-6">
            <SectionHeading icon={ClipboardCheck} title="Assessment and approval" />
            <InfoList
              rows={[
                ["Assessor", claim.assessorName || "Not recorded"],
                ["Assessment date", dateLabel(claim.assessmentDate)],
                ["Reference", claim.assessmentReference || "Not recorded"],
                ["Approval", label(claim.approvalStatus || claim.status)],
              ]}
            />
          </section>

          <section className="card p-5 sm:p-6">
            <SectionHeading icon={ReceiptText} title="Release and settlement" />
            <InfoList
              rows={[
                ["Release state", label(claim.releaseStatus || "blocked")],
                ["Release reference", claim.releaseOrderNumber || "Not recorded"],
                ["Release order date", dateLabel(claim.releaseOrderDate)],
                ["Vehicle released", dateLabel(claim.releasedAt)],
                ["Expected settlement", dateLabel(claim.expectedSettlementDate)],
                ["Regulatory due date", dateLabel(claim.regulatorySettlementDate)],
              ]}
            />
            <div className="mt-4 rounded-xl bg-surface-muted p-4 text-sm text-ink-soft">
              A release order authorises controlled release but does not count as received money.
            </div>
          </section>

          <section className="card p-5 sm:p-6">
            <SectionHeading icon={Landmark} title="Linked records" />
            <LinkedRecord icon={User} label="Customer" value={customer?.displayName ?? "Not available"} />
            <LinkedRecord
              icon={Car}
              label="Vehicle"
              value={vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.plateNumber}` : "Not available"}
            />
            <LinkedRecord icon={ClipboardCheck} label="Delivered Job Card" value={job?.complaint ?? claim.jobCardId} href={`/dashboard/job-cards/${claim.jobCardId}`} />
          </section>

          <section className="card p-5 sm:p-6">
            <SectionHeading icon={CalendarClock} title="Case dates" />
            <InfoList
              rows={[
                ["Case created", dateLabel(claim.createdAt as DateLike)],
                ["Quantum established", dateLabel(claim.quantumEstablishedAt)],
                ["Discharge documents", dateLabel(claim.dischargeDocumentsReceivedAt)],
                ["Last updated", dateLabel(claim.updatedAt)],
              ]}
            />
          </section>

          {claim.notes && (
            <section className="card p-5 sm:p-6">
              <SectionHeading icon={FileText} title="Case notes" />
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{claim.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Reminder({
  expectedDate,
  dayDifference,
  reconciled,
  insurerOutstanding,
}: {
  expectedDate: DateLike;
  dayDifference: number | null;
  reconciled: boolean;
  insurerOutstanding: number;
}) {
  if (reconciled) {
    return (
      <div className="card flex items-start gap-3 border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
        <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Settlement reconciled</p>
          <p className="mt-1 text-sm">No payment reminder is currently required.</p>
        </div>
      </div>
    );
  }

  if (!expectedDate || dayDifference === null) {
    return (
      <div className="card flex items-start gap-3 p-5">
        <CalendarClock size={20} className="mt-0.5 shrink-0 text-burgundy-600" />
        <div>
          <p className="font-semibold text-ink">Settlement reminder</p>
          <p className="mt-1 text-sm text-ink-soft">Add an expected settlement date to calculate due and overdue reminders.</p>
          <p className="mt-3 text-xs text-ink-faint">Reminders update automatically from the recorded date.</p>
        </div>
      </div>
    );
  }

  const overdue = dayDifference > 0;
  const dueToday = dayDifference === 0;
  return (
    <div className={`card flex items-start gap-3 p-5 ${overdue ? "border-rose-200 bg-rose-50 text-rose-900" : dueToday ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900"}`}>
      {overdue ? <AlertCircle size={20} className="mt-0.5 shrink-0" /> : <CalendarClock size={20} className="mt-0.5 shrink-0" />}
      <div>
        <p className="font-semibold">
          {overdue
            ? `${dayDifference} day${dayDifference === 1 ? "" : "s"} overdue`
            : dueToday
              ? "Settlement expected today"
              : `Settlement due in ${Math.abs(dayDifference)} day${Math.abs(dayDifference) === 1 ? "" : "s"}`}
        </p>
        <p className="mt-1 text-sm">
          {formatMoney(insurerOutstanding)} insurer payment remains · due {dateLabel(expectedDate)}
        </p>
        <p className="mt-3 text-xs opacity-75">Calculated from the recorded expected settlement date.</p>
      </div>
    </div>
  );
}

function StatusBox({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-muted p-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{title}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function SectionHeading({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="mb-5 flex items-start gap-3 border-b border-line pb-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-burgundy-50 text-burgundy-600"><Icon size={17} /></div>
      <div>
        <h2 className="font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
    </div>
  );
}

function MoneyBox({ label: text, value, strong, warning }: { label: string; value: number; strong?: boolean; warning?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${warning ? "border-amber-200 bg-amber-50" : strong ? "border-burgundy-200 bg-burgundy-50" : "border-line bg-surface-muted/35"}`}>
      <p className="text-xs text-ink-faint">{text}</p>
      <p className={`mt-1 ${strong ? "text-lg" : "text-base"} font-semibold text-ink`}>{formatMoney(value)}</p>
    </div>
  );
}

function InfoList({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([term, description]) => (
        <div key={term} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <dt className="text-sm text-ink-faint">{term}</dt>
          <dd className="text-right text-sm font-medium text-ink">{description}</dd>
        </div>
      ))}
    </dl>
  );
}

function LinkedRecord({ icon: Icon, label: text, value, href }: { icon: React.ElementType; label: string; value: string; href?: string }) {
  const content = (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-burgundy-600"><Icon size={17} /></div>
      <div className="min-w-0">
        <p className="text-xs text-ink-faint">{text}</p>
        <p className="truncate text-sm font-medium text-ink">{value}</p>
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="mb-2 flex items-center justify-between rounded-xl border border-line p-3 transition hover:bg-surface-muted">
      {content}<ExternalLink size={15} className="shrink-0 text-ink-faint" />
    </Link>
  ) : (
    <div className="mb-2 rounded-xl border border-line p-3">{content}</div>
  );
}
