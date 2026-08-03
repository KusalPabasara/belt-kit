"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Car,
  ClipboardCheck,
  FileCheck2,
  Filter,
  Landmark,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  User,
  WalletCards,
} from "lucide-react";

import { Badge, EmptyState, PageHeader, SearchInput, TableSkeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatMoney } from "@/lib/format";
import { Customer, InsuranceClaim, JobCard, Vehicle } from "@/lib/models";
import { useCollection } from "@/lib/useCollection";

type DateValue =
  | Date
  | string
  | number
  | { toDate?: () => Date; seconds?: number }
  | null;

/**
 * The case workspace is being introduced without breaking existing claim
 * records. These fields are optional so legacy documents continue to render
 * while newly migrated claims can expose the full workflow.
 */
type CaseClaim = InsuranceClaim & {
  caseStage?: string;
  claimStage?: string;
  stage?: string;
  approvalStatus?: string;
  documentStatus?: string;
  documentsStatus?: string;
  requiredDocumentsComplete?: boolean;
  requiredDocumentsVerified?: boolean;
  documentsComplete?: boolean;
  documentsVerified?: boolean;
  assessmentStatus?: string;
  assessorStatus?: string;
  releaseStatus?: string;
  releaseEligible?: boolean;
  vehicleReleased?: boolean;
  releasedAt?: DateValue;
  settlementStatus?: string;
  paymentStatus?: string;
  expectedPaymentAt?: DateValue;
  expectedPaymentDate?: DateValue;
  expectedSettlementDate?: DateValue;
  paymentExpectedAt?: DateValue;
  promisedPaymentAt?: DateValue;
  paymentDueAt?: DateValue;
  regulatoryDueAt?: DateValue;
  regulatoryPaymentDueAt?: DateValue;
  regulatorySettlementDate?: DateValue;
  insurerResponsibilityMinor?: number;
  insurerLiabilityMinor?: number;
  insurerApprovedAmountMinor?: number;
  insurerReceivedMinor?: number;
  insurerPaidMinor?: number;
  customerResponsibilityMinor?: number;
  customerLiabilityMinor?: number;
  customerShareMinor?: number;
  customerReceivedMinor?: number;
  customerPaidMinor?: number;
  insurerOutstandingMinor?: number;
  customerOutstandingMinor?: number;
  finalInvoiceAmountMinor?: number;
  finalInvoiceTotalMinor?: number;
  invoiceTotalMinor?: number;
  finalInvoiceGenerated?: boolean;
  updatedAt?: DateValue;
};

type StageKey =
  | "intake"
  | "documents"
  | "assessment"
  | "approval"
  | "repair"
  | "invoice"
  | "release"
  | "settlement"
  | "closed";

type PaymentState = "unpaid" | "part_paid" | "paid";

type ClaimRow = {
  claim: CaseClaim;
  customer: string;
  vehicle: string;
  plateNumber: string;
  job: string;
  stage: StageKey;
  status: string;
  insurerResponsibilityMinor: number;
  insurerReceivedMinor: number;
  customerResponsibilityMinor: number;
  customerReceivedMinor: number;
  insurerOutstandingMinor: number;
  customerOutstandingMinor: number;
  totalOutstandingMinor: number;
  paymentState: PaymentState;
  released: boolean;
  releasedAwaitingPayment: boolean;
  readyForRelease: boolean;
  awaitingDocuments: boolean;
  awaitingAssessment: boolean;
  dueDate: Date | null;
  dueKind: "regulatory" | "expected" | null;
  overdue: boolean;
  createdAt: Date | null;
};

const STAGE_LABELS: Record<StageKey, string> = {
  intake: "Intake",
  documents: "Documents",
  assessment: "Assessment",
  approval: "Approval",
  repair: "Repair",
  invoice: "Final invoice",
  release: "Release",
  settlement: "Settlement",
  closed: "Closed",
};

const STAGE_ORDER: StageKey[] = [
  "intake",
  "documents",
  "assessment",
  "approval",
  "repair",
  "invoice",
  "release",
  "settlement",
  "closed",
];

function normaliseValue(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
    : "";
}

function displayValue(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstMinor(...values: unknown[]): number | null {
  const value = values.find(
    (candidate) => typeof candidate === "number" && Number.isFinite(candidate),
  );
  return typeof value === "number" ? Math.max(0, Math.round(value)) : null;
}

function dateFromValue(value: DateValue | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === "string" || typeof value === "number") {
    const timestamp = typeof value === "number" && value < 10_000_000_000
      ? value * 1000
      : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value.toDate === "function") {
    try {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }

  if (typeof value.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function canonicalStage(claim: CaseClaim): StageKey {
  const raw = normaliseValue(claim.caseStage || claim.claimStage || claim.stage);
  if (raw.includes("document")) return "documents";
  if (raw.includes("assess") || raw.includes("inspect") || raw.includes("estimate")) {
    return "assessment";
  }
  if (raw.includes("approv") || raw.includes("liability")) return "approval";
  if (raw.includes("repair")) return "repair";
  if (raw.includes("invoice")) return "invoice";
  if (raw.includes("release") || raw.includes("ready")) return "release";
  if (raw.includes("settle") || raw.includes("payment") || raw.includes("receivable")) {
    return "settlement";
  }
  if (raw.includes("closed") || raw.includes("complete") || raw.includes("reconciled")) {
    return "closed";
  }
  if (raw.includes("intake") || raw.includes("new") || raw.includes("register")) return "intake";

  // Legacy records were created only from delivered jobs. Their old status is
  // mapped to the closest case stage without changing stored data.
  if (claim.status === "received" || claim.status === "rejected") return "closed";
  if (claim.status === "approved") return "settlement";
  if (claim.status === "pending") return "assessment";
  return "intake";
}

function stageTone(stage: StageKey): "neutral" | "burgundy" | "green" | "amber" | "blue" {
  if (stage === "closed") return "green";
  if (stage === "settlement" || stage === "release") return "blue";
  if (stage === "assessment" || stage === "approval") return "amber";
  if (stage === "repair" || stage === "invoice") return "burgundy";
  return "neutral";
}

function paymentLabel(row: ClaimRow): string {
  if (row.releasedAwaitingPayment) return "Released · payment pending";
  if (row.paymentState === "paid") return "Paid";
  if (row.paymentState === "part_paid") return "Part paid";
  return "Unpaid";
}

function dueDescription(row: ClaimRow): string {
  if (!row.dueDate) return "No payment due date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(row.dueDate);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

export default function InsurancePage() {
  const { role } = useAuth();
  const { data: claims, loading } = useCollection<InsuranceClaim>("insuranceClaims");
  const { data: customers } = useCollection<Customer>("customers");
  const { data: vehicles } = useCollection<Vehicle>("vehicles");
  const { data: jobs } = useCollection<JobCard>("jobCards");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [insurerFilter, setInsurerFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const canAddFromFinishedJob = role === "owner" || role === "manager" || role === "advisor";

  const rows = useMemo<ClaimRow[]>(() => {
    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return (claims as CaseClaim[])
      .filter((claim) => !claim.archived)
      .map((claim) => {
        const customer = customerById.get(claim.customerId);
        const vehicle = vehicleById.get(claim.vehicleId);
        const job = jobById.get(claim.jobCardId);
        const stage = canonicalStage(claim);

        const insurerResponsibilityMinor = firstMinor(
          claim.insurerResponsibilityMinor,
          claim.insurerLiabilityMinor,
          claim.insurerApprovedAmountMinor,
          claim.claimAmountMinor,
        ) ?? 0;
        const insurerReceivedMinor = firstMinor(
          claim.insurerReceivedMinor,
          claim.insurerPaidMinor,
          claim.receivedAmountMinor,
        ) ?? 0;

        const finalInvoiceMinor = firstMinor(
          claim.finalInvoiceAmountMinor,
          claim.finalInvoiceTotalMinor,
          claim.invoiceTotalMinor,
        );
        const calculatedCustomerShare = finalInvoiceMinor === null
          ? 0
          : Math.max(0, finalInvoiceMinor - insurerResponsibilityMinor);
        const customerResponsibilityMinor = firstMinor(
          claim.customerResponsibilityMinor,
          claim.customerLiabilityMinor,
          claim.customerShareMinor,
          calculatedCustomerShare,
        ) ?? 0;
        const customerReceivedMinor = firstMinor(
          claim.customerReceivedMinor,
          claim.customerPaidMinor,
        ) ?? 0;

        const insurerOutstandingMinor = firstMinor(claim.insurerOutstandingMinor)
          ?? Math.max(0, insurerResponsibilityMinor - insurerReceivedMinor);
        const customerOutstandingMinor = firstMinor(claim.customerOutstandingMinor)
          ?? Math.max(0, customerResponsibilityMinor - customerReceivedMinor);
        const totalOutstandingMinor = insurerOutstandingMinor + customerOutstandingMinor;

        const explicitPaymentStatus = normaliseValue(
          claim.settlementStatus || claim.paymentStatus,
        );
        const totalReceivedMinor = insurerReceivedMinor + customerReceivedMinor;
        let paymentState: PaymentState = totalReceivedMinor > 0 ? "part_paid" : "unpaid";
        if (
          totalOutstandingMinor === 0
          && (insurerResponsibilityMinor + customerResponsibilityMinor > 0)
        ) {
          paymentState = "paid";
        }
        if (["paid", "settled", "reconciled", "closed"].includes(explicitPaymentStatus)) {
          paymentState = "paid";
        } else if (explicitPaymentStatus.includes("part")) {
          paymentState = "part_paid";
        }

        const releaseStatus = normaliseValue(claim.releaseStatus);
        const released = claim.vehicleReleased === true
          || !!dateFromValue(claim.releasedAt)
          || ["released", "completed"].includes(releaseStatus);
        const readyForRelease = !released && (
          claim.releaseEligible === true
          || ["eligible", "ready", "ready_for_release", "approved_for_release"].includes(releaseStatus)
        );

        const documentStatus = normaliseValue(
          claim.documentStatus || claim.documentsStatus,
        );
        const awaitingDocuments = claim.requiredDocumentsComplete === false
          || claim.requiredDocumentsVerified === false
          || claim.documentsComplete === false
          || claim.documentsVerified === false
          || ["missing", "incomplete", "pending", "awaiting", "rejected"].includes(documentStatus);

        const assessmentStatus = normaliseValue(
          claim.assessmentStatus || claim.assessorStatus,
        );
        const awaitingAssessment = stage === "assessment"
          || ["pending", "awaiting", "scheduled", "in_progress"].includes(assessmentStatus);

        const regulatoryDue = dateFromValue(
          claim.regulatorySettlementDate
            || claim.regulatoryDueAt
            || claim.regulatoryPaymentDueAt,
        );
        const expectedDue = dateFromValue(
          claim.expectedSettlementDate
            || claim.expectedPaymentAt
            || claim.expectedPaymentDate
            || claim.paymentExpectedAt
            || claim.promisedPaymentAt
            || claim.paymentDueAt,
        );
        const dueDate = regulatoryDue && expectedDue
          ? (regulatoryDue <= expectedDue ? regulatoryDue : expectedDue)
          : regulatoryDue || expectedDue;
        const dueKind = dueDate
          ? (regulatoryDue && dueDate.getTime() === regulatoryDue.getTime()
              ? "regulatory" as const
              : "expected" as const)
          : null;
        const overdue = totalOutstandingMinor > 0 && !!dueDate && dueDate < today;
        const releasedAwaitingPayment = released && totalOutstandingMinor > 0;

        return {
          claim,
          customer: customer?.displayName ?? "Unknown customer",
          vehicle: vehicle
            ? `${vehicle.make} ${vehicle.model}`.trim()
            : "Unknown vehicle",
          plateNumber: vehicle?.plateNumber ?? "—",
          job: job?.complaint ?? "Job details unavailable",
          stage,
          status: normaliseValue(claim.approvalStatus || claim.status) || "pending",
          insurerResponsibilityMinor,
          insurerReceivedMinor,
          customerResponsibilityMinor,
          customerReceivedMinor,
          insurerOutstandingMinor,
          customerOutstandingMinor,
          totalOutstandingMinor,
          paymentState,
          released,
          releasedAwaitingPayment,
          readyForRelease,
          awaitingDocuments,
          awaitingAssessment,
          dueDate,
          dueKind,
          overdue,
          createdAt: dateFromValue(claim.createdAt),
        };
      })
      .sort((left, right) => {
        if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
        if (left.releasedAwaitingPayment !== right.releasedAwaitingPayment) {
          return left.releasedAwaitingPayment ? -1 : 1;
        }
        return (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0);
      });
  }, [claims, customers, jobs, vehicles]);

  const insurerOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.claim.companyName).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right)),
    [rows],
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.status))).sort(),
    [rows],
  );

  const summary = useMemo(() => ({
    insurerOutstandingMinor: rows.reduce(
      (total, row) => total + row.insurerOutstandingMinor,
      0,
    ),
    customerOutstandingMinor: rows.reduce(
      (total, row) => total + row.customerOutstandingMinor,
      0,
    ),
    releasedAwaitingPayment: rows.filter((row) => row.releasedAwaitingPayment).length,
    overdue: rows.filter((row) => row.overdue).length,
    awaitingWork: rows.filter(
      (row) => row.awaitingDocuments || row.awaitingAssessment,
    ).length,
    readyForRelease: rows.filter((row) => row.readyForRelease).length,
  }), [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch = !query || [
        row.claim.companyName,
        row.claim.claimNumber,
        row.claim.policyNumber,
        row.claim.id,
        row.customer,
        row.vehicle,
        row.plateNumber,
        row.job,
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
      const matchesStage = stageFilter === "all" || row.stage === stageFilter;
      const matchesStatus = statusFilter === "all" || row.status === statusFilter;
      const matchesInsurer = insurerFilter === "all"
        || row.claim.companyName === insurerFilter;
      const matchesPayment = paymentFilter === "all"
        || (paymentFilter === "outstanding" && row.totalOutstandingMinor > 0)
        || (paymentFilter === "released_pending" && row.releasedAwaitingPayment)
        || row.paymentState === paymentFilter;
      const matchesDue = dueFilter === "all"
        || (dueFilter === "overdue" && row.overdue)
        || (dueFilter === "not_overdue" && !row.overdue);

      return matchesSearch
        && matchesStage
        && matchesStatus
        && matchesInsurer
        && matchesPayment
        && matchesDue;
    });
  }, [dueFilter, insurerFilter, paymentFilter, rows, search, stageFilter, statusFilter]);

  const filtersActive = search !== ""
    || statusFilter !== "all"
    || stageFilter !== "all"
    || insurerFilter !== "all"
    || paymentFilter !== "all"
    || dueFilter !== "all";

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setStageFilter("all");
    setInsurerFilter("all");
    setPaymentFilter("all");
    setDueFilter("all");
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Finance"
        title="Insurance Cases"
        icon={ShieldCheck}
        action={canAddFromFinishedJob && (
          <Link href="/dashboard/job-cards/finished-jobs" className="btn-primary">
            <ReceiptText size={17} /> Add from finished job
          </Link>
        )}
      />

      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl bg-surface-muted" />
            ))}
          </div>
          <TableSkeleton cols={6} rows={6} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No insurance cases"
          hint="Insurance cases begin from delivered jobs, keeping the repair and final invoice connected."
          action={canAddFromFinishedJob ? (
            <Link href="/dashboard/job-cards/finished-jobs" className="btn-primary">
              Open finished jobs
            </Link>
          ) : undefined}
        />
      ) : (
        <div className="space-y-6">
          <section aria-label="Insurance case summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              icon={Landmark}
              label="Insurer outstanding"
              value={formatMoney(summary.insurerOutstandingMinor)}
              hint={`${rows.filter((row) => row.insurerOutstandingMinor > 0).length} case${rows.filter((row) => row.insurerOutstandingMinor > 0).length === 1 ? "" : "s"} to collect`}
              tone="blue"
            />
            <SummaryCard
              icon={WalletCards}
              label="Customer outstanding"
              value={formatMoney(summary.customerOutstandingMinor)}
              hint="Excess, shortfall and approved customer share"
              tone="amber"
            />
            <SummaryCard
              icon={Car}
              label="Released · payment pending"
              value={String(summary.releasedAwaitingPayment)}
              hint="Vehicle release is not treated as payment"
              tone="burgundy"
            />
            <SummaryCard
              icon={CalendarClock}
              label="Overdue payments"
              value={String(summary.overdue)}
              hint="Calculated from expected and regulatory dates"
              tone="red"
            />
            <SummaryCard
              icon={FileCheck2}
              label="Documents / assessment"
              value={String(summary.awaitingWork)}
              hint="Cases needing intake evidence or assessor action"
              tone="neutral"
            />
            <SummaryCard
              icon={ClipboardCheck}
              label="Ready for release"
              value={String(summary.readyForRelease)}
              hint="Eligible cases that have not been released"
              tone="green"
            />
          </section>

          <section className="rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Filter size={17} className="text-burgundy-600" />
                  <h2 className="font-semibold text-ink">Find a case</h2>
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  Filter the register without changing or reloading claim data.
                </p>
              </div>
              {filtersActive && (
                <button type="button" onClick={clearFilters} className="btn-ghost self-start">
                  <RotateCcw size={15} /> Reset filters
                </button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Claim, vehicle, customer…"
                className="md:col-span-2 xl:col-span-2"
              />
              <FilterSelect label="Stage" value={stageFilter} onChange={setStageFilter}>
                <option value="all">All stages</option>
                {STAGE_ORDER.map((stage) => (
                  <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
                ))}
              </FilterSelect>
              <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}>
                <option value="all">All statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>{displayValue(status)}</option>
                ))}
              </FilterSelect>
              <FilterSelect label="Insurer" value={insurerFilter} onChange={setInsurerFilter}>
                <option value="all">All insurers</option>
                {insurerOptions.map((insurer) => (
                  <option key={insurer} value={insurer}>{insurer}</option>
                ))}
              </FilterSelect>
              <FilterSelect label="Payment" value={paymentFilter} onChange={setPaymentFilter}>
                <option value="all">All payments</option>
                <option value="outstanding">Any outstanding</option>
                <option value="unpaid">Unpaid</option>
                <option value="part_paid">Part paid</option>
                <option value="paid">Paid</option>
                <option value="released_pending">Released · pending</option>
              </FilterSelect>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
              <span className="text-xs font-medium text-ink-faint">Payment due:</span>
              {[
                { value: "all", label: "Any" },
                { value: "overdue", label: "Overdue" },
                { value: "not_overdue", label: "Not overdue" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDueFilter(option.value)}
                  aria-pressed={dueFilter === option.value}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    dueFilter === option.value
                      ? "border-burgundy-600 bg-burgundy-600 text-white"
                      : "border-line bg-white text-ink-soft hover:border-burgundy-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-ink-faint">
                {filteredRows.length} of {rows.length} cases
              </span>
            </div>
          </section>

          {filteredRows.length === 0 ? (
            <EmptyState
              icon={Filter}
              title="No cases match these filters"
              hint="Clear the filters or try a different claim, vehicle or customer search."
              action={
                <button type="button" onClick={clearFilters} className="btn-secondary">
                  Clear filters
                </button>
              }
            />
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-2xl border border-line bg-white shadow-sm lg:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1040px] text-left text-sm">
                    <thead className="border-b border-line bg-surface-muted/70">
                      <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                        <th className="px-5 py-3">Case / insurer</th>
                        <th className="px-5 py-3">Customer / vehicle</th>
                        <th className="px-5 py-3">Workflow</th>
                        <th className="px-5 py-3 text-right">Outstanding</th>
                        <th className="px-5 py-3">Next payment</th>
                        <th className="px-5 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/80">
                      {filteredRows.map((row) => <DesktopCaseRow key={row.claim.id} row={row} />)}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
                {filteredRows.map((row) => <MobileCaseCard key={row.claim.id} row={row} />)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint: string;
  tone: "blue" | "amber" | "burgundy" | "red" | "neutral" | "green";
}) {
  const tones = {
    blue: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    burgundy: "bg-burgundy-50 text-burgundy-700",
    red: "bg-rose-50 text-rose-700",
    neutral: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
  };

  return (
    <article className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon size={19} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-soft">{label}</p>
          <p className="mt-0.5 truncate text-xl font-bold tabular-nums text-ink">{value}</p>
          <p className="mt-1 text-[11px] leading-4 text-ink-faint">{hint}</p>
        </div>
      </div>
    </article>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-luxe h-full min-h-[46px] pr-9"
        aria-label={label}
      >
        {children}
      </select>
    </label>
  );
}

function PaymentBadge({ row }: { row: ClaimRow }) {
  if (row.overdue) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
        <AlertTriangle size={12} /> Overdue
      </span>
    );
  }
  if (row.releasedAwaitingPayment) return <Badge tone="amber">Released · pending</Badge>;
  if (row.paymentState === "paid") return <Badge tone="green">Paid</Badge>;
  if (row.paymentState === "part_paid") return <Badge tone="blue">Part paid</Badge>;
  return <Badge tone="neutral">Unpaid</Badge>;
}

function OutstandingBreakdown({ row }: { row: ClaimRow }) {
  if (row.totalOutstandingMinor === 0) {
    return <span className="font-semibold text-emerald-700">Fully received</span>;
  }
  return (
    <div>
      <p className="font-semibold tabular-nums text-ink">{formatMoney(row.totalOutstandingMinor)}</p>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        Insurer {formatMoney(row.insurerOutstandingMinor)}
        {row.customerResponsibilityMinor > 0 && (
          <> · Customer {formatMoney(row.customerOutstandingMinor)}</>
        )}
      </p>
    </div>
  );
}

function DesktopCaseRow({ row }: { row: ClaimRow }) {
  return (
    <tr className="group transition hover:bg-burgundy-50/25">
      <td className="px-5 py-4 align-top">
        <p className="max-w-[210px] truncate font-semibold text-ink">{row.claim.companyName}</p>
        <p className="mt-1 text-xs text-ink-faint">
          {row.claim.claimNumber || `Case ${row.claim.id.slice(0, 8).toUpperCase()}`}
        </p>
        {row.claim.policyNumber && (
          <p className="mt-0.5 text-[11px] text-ink-faint">Policy {row.claim.policyNumber}</p>
        )}
      </td>
      <td className="px-5 py-4 align-top">
        <p className="flex max-w-[220px] items-center gap-1.5 truncate font-medium text-ink">
          <User size={13} className="shrink-0 text-ink-faint" /> {row.customer}
        </p>
        <p className="mt-1 flex max-w-[220px] items-center gap-1.5 truncate text-xs text-ink-soft">
          <Car size={13} className="shrink-0 text-ink-faint" /> {row.vehicle} · {row.plateNumber}
        </p>
      </td>
      <td className="px-5 py-4 align-top">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={stageTone(row.stage)}>{STAGE_LABELS[row.stage]}</Badge>
          <PaymentBadge row={row} />
        </div>
        <p className="mt-2 max-w-[190px] truncate text-[11px] text-ink-faint" title={row.job}>
          {row.job}
        </p>
      </td>
      <td className="px-5 py-4 text-right align-top">
        <OutstandingBreakdown row={row} />
      </td>
      <td className="px-5 py-4 align-top">
        {row.dueDate ? (
          <div className={row.overdue ? "text-rose-700" : "text-ink-soft"}>
            <p className="font-semibold">{dueDescription(row)}</p>
            <p className="mt-0.5 text-[11px]">
              {row.dueKind === "regulatory" ? "Regulatory" : "Expected"} · {formatDate(row.dueDate)}
            </p>
          </div>
        ) : (
          <span className="text-xs text-ink-faint">No due date recorded</span>
        )}
      </td>
      <td className="px-5 py-4 text-right align-middle">
        <Link
          href={`/dashboard/insurance/${row.claim.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-burgundy-700 transition hover:bg-burgundy-50"
        >
          Open <ArrowRight size={14} />
        </Link>
      </td>
    </tr>
  );
}

function MobileCaseCard({ row }: { row: ClaimRow }) {
  return (
    <Link
      href={`/dashboard/insurance/${row.claim.id}`}
      className="group rounded-2xl border border-line bg-white p-4 shadow-sm transition hover:border-burgundy-200 hover:shadow-luxe"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{row.claim.companyName}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {row.claim.claimNumber || `Case ${row.claim.id.slice(0, 8).toUpperCase()}`}
          </p>
        </div>
        <ArrowRight size={17} className="shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-burgundy-600" />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={stageTone(row.stage)}>{STAGE_LABELS[row.stage]}</Badge>
        <PaymentBadge row={row} />
      </div>
      <div className="mt-4 space-y-2 text-xs text-ink-soft">
        <p className="flex items-center gap-2"><User size={14} /> {row.customer}</p>
        <p className="flex items-center gap-2"><Car size={14} /> {row.vehicle} · {row.plateNumber}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Outstanding</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
            {formatMoney(row.totalOutstandingMinor)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Payment due</p>
          <p className={`mt-1 text-sm font-semibold ${row.overdue ? "text-rose-700" : "text-ink"}`}>
            {row.dueDate ? dueDescription(row) : "Not recorded"}
          </p>
        </div>
      </div>
    </Link>
  );
}
