"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { doc, getDoc, onSnapshot, collection, getDocs, query, where as fsWhere, Timestamp } from "firebase/firestore";
import { generateInvoiceClient } from "@/lib/invoice";
import {
  ArrowLeft,
  Car,
  User,
  Users,
  Check,
  Trash2,
  Wrench,
  Package,
  Receipt,
  ArrowRight,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { db, auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useCollection, where } from "@/lib/useCollection";
import { createDoc, updateDocById, deleteDocById } from "@/lib/db-write";
import {
  JobCard,
  Customer,
  Vehicle,
  JobCardLine,
  Part,
  Branch,
  ExtraCharge,
  DiscountType,
  JobStatus,
  ServiceType,
  JOB_STATUS_META,
  JOB_STATUS_ORDER,
} from "@/lib/models";
import { formatMoney, toMinor } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/billing-calculations";
import {
  CenterSpinner,
  EmptyState,
  Badge,
  Modal,
  Field,
  ConfirmDialog,
  useToast,
} from "@/components/ui";
import { VehicleCheckIn } from "@/components/VehicleCheckIn";
import { JobPhotos } from "@/components/JobPhotos";

type EditableCharge = { description: string; amount: string };

export default function JobCardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { role } = useAuth();
  const { notify } = useToast();

  const [job, setJob] = useState<JobCard | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
const [customers, setCustomers] = useState<(Customer & { id: string })[]>([]);
const [editVehicles, setEditVehicles] = useState<(Vehicle & { id: string })[]>([]);

  const { data: lines } = useCollection<JobCardLine>("jobCardLines", [
    where("jobCardId", "==", id),
  ]);
  const { data: parts } = useCollection<Part>("parts");
  const { data: services } = useCollection<ServiceType>("services");
  const { data: branches } = useCollection<Branch>("branches");
  const today = new Date().toISOString().split("T")[0];
  const serviceNames = (ids: string[]) =>
    services
      .filter((s) => ids?.includes(s.id))
      .map((s) => s.name)
      .join(", ");

  const [lineModal, setLineModal] = useState(false);
  const [lineKind, setLineKind] = useState<"labor" | "part">("labor");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [invoicing, setInvoicing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [technicians, setTechnicians] = useState<{ uid: string; name: string }[]>([]);
  const [editOpen,setEditOpen]=useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
const [editCustomer, setEditCustomer] = useState("");
const [editVehicle, setEditVehicle] = useState("");
const [editServices, setEditServices] = useState<string[]>([]);
const [editTechnicians, setEditTechnicians] = useState<string[]>([]);
const [editScheduledDate, setEditScheduledDate] = useState("");
const [completionNotes, setCompletionNotes] = useState("");

  // Pricing (extra charges + discount) state.
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricingSaving, setPricingSaving] = useState(false);
  const [charges, setCharges] = useState<EditableCharge[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>("percent");
  const [discountValueStr, setDiscountValueStr] = useState("0");
  const [taxRateValueStr, setTaxRateValueStr] = useState("0");

  useEffect(() => {
    if (role !== "owner" && role !== "manager" && role !== "advisor") return;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "users"), fsWhere("role", "==", "technician"))
        );
        setTechnicians(
          snap.docs.map((d) => ({
            uid: d.id,
            name: (d.data().displayName as string) || (d.data().email as string) || d.id,
          }))
        );
      } catch {
        /* ignore */
      }
    })();
  }, [role]);

  useEffect(() => {
  async function loadCustomers() {
    const snap = await getDocs(collection(db,"customers"));

    setCustomers(
  snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
  })) as (Customer & { id: string })[]
);
  }

  loadCustomers();
},[]);

useEffect(()=>{

if(!editCustomer){
 setEditVehicles([]);
 return;
}


async function loadVehicles(){

const snap = await getDocs(
 query(
  collection(db,"vehicles"),
  fsWhere("customerId","==",editCustomer)
 )
);


setEditVehicles(
 snap.docs.map(d => ({
   id: d.id,
   ...d.data(),
 })) as (Vehicle & { id: string })[]
);


}


loadVehicles();


},[editCustomer]);

  

  async function toggleTechnician(uid: string) {
    if (!job) return;
    const current = job.assignedTechnicianIds || [];
    const next = current.includes(uid)
      ? current.filter((x) => x !== uid)
      : [...current, uid];
    try {
      await updateDocById("jobCards", id, { assignedTechnicianIds: next });
      notify("Technician assignment updated.");
    } catch {
      notify("Could not update assignment.", "error");
    }
  }

  async function updateJob(form: FormData) {

  try {

    await updateDocById(
  "jobCards",
  id,
  {
    customerId: String(form.get("customerId")),

    vehicleId: String(form.get("vehicleId")),

    complaint: String(form.get("complaint")),

    serviceTypeIds: editServices,

    assignedTechnicianIds: editTechnicians,

    scheduledDate: form.get("scheduledDate")
      ? Timestamp.fromDate(
          new Date(String(form.get("scheduledDate")))
        )
      : null,

    startDate: form.get("startDate")
      ? Timestamp.fromDate(
          new Date(String(form.get("startDate")))
        )
      : null,

    promisedEndDate: form.get("promisedEndDate")
      ? Timestamp.fromDate(
          new Date(String(form.get("promisedEndDate")))
        )
      : null,
  }
);


    notify("Job updated.");

    setEditOpen(false);


  } catch {

    notify(
      "Could not update job.",
      "error"
    );

  }
}

async function deleteJob() {
 try {

   await updateDocById(
    "jobCards",
    id,
    {
      archived:true
    }
   );

   notify("Job card deleted.");

   router.push("/dashboard/job-cards");

 } catch {

   notify(
    "Could not delete job card.",
    "error"
   );

 }
}
  

  const readOnly = job?.status === "delivered";

const canEditJob =
  role === "owner" ||
  role === "manager" ||
  role === "advisor";

const canDoFinancial =
  role === "owner" ||
  role === "manager" ||
  role === "advisor" ||
  role === "accountant";

const isTech = role === "technician";

const canAssign =
  !readOnly &&
  (
    role === "owner" ||
    role === "manager" ||
    role === "advisor"
  );

const isAssignedTech =
  isTech &&
  !!job &&
  (job.assignedTechnicianIds || [])
    .includes(auth.currentUser?.uid ?? "__none__");

const canEditLines =
  !readOnly &&
  (canEditJob || isAssignedTech);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "jobCards", id), async (snap) => {
      if (!snap.exists()) { setLoading(false); return; }
      const j = snap.data() as JobCard;
      setJob(j);
      setCompletionNotes(j.completionNotes || "");
      setLoading(false);
      if (j.customerId && !customer) {
        const cs = await getDoc(doc(db, "customers", j.customerId));
        if (cs.exists()) setCustomer(cs.data() as Customer);
      }
      if (j.vehicleId && !vehicle) {
        const vs = await getDoc(doc(db, "vehicles", j.vehicleId));
        if (vs.exists()) setVehicle(vs.data() as Vehicle);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const baseSubtotalMinor = useMemo(
    () => lines.reduce((sum, line) => sum + (line.lineTotalMinor || 0), 0),
    [lines]
  );
  const branch = branches.find((item) => item.id === job?.branchId);
  const jobTaxRate =
    typeof job?.taxRatePercent === "number" ? job.taxRatePercent : branch?.taxRatePercent ?? 0;
  const totals = useMemo(
    () =>
      calculateInvoiceTotals({
        baseSubtotalMinor,
        extraCharges: job?.extraCharges,
        discountType: job?.discountType,
        discountValue: job?.discountValue,
        taxRatePercent: jobTaxRate,
      }),
    [baseSubtotalMinor, job?.discountType, job?.discountValue, job?.extraCharges, jobTaxRate]
  );
  const editableExtraCharges = useMemo<ExtraCharge[]>(
    () => charges.map((charge) => ({ description: charge.description.trim(), amountMinor: toMinor(charge.amount) })),
    [charges]
  );
  const livePricingTotals = useMemo(
    () =>
      calculateInvoiceTotals({
        baseSubtotalMinor,
        extraCharges: editableExtraCharges,
        discountType,
        discountValue: discountType === "fixed" ? toMinor(discountValueStr) : Number(discountValueStr),
        taxRatePercent: Number(taxRateValueStr),
      }),
    [baseSubtotalMinor, discountType, discountValueStr, editableExtraCharges, taxRateValueStr]
  );

  useEffect(() => {
    if (!job || job.invoiceId) return;
    if (!canEditJob) return;
    if (job.subtotalMinor !== totals.baseSubtotalMinor || job.taxMinor !== totals.taxMinor || job.totalMinor !== totals.totalMinor) {
      updateDocById("jobCards", id, {
        subtotalMinor: totals.baseSubtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.baseSubtotalMinor, totals.taxMinor, totals.totalMinor, canEditJob]);

  function openPricing() {
    if (!job) return;
    setCharges((job.extraCharges ?? []).map((charge) => ({
      description: charge.description,
      amount: (charge.amountMinor / 100).toFixed(2),
    })));
    const type = job.discountType ?? "percent";
    setDiscountType(type);
    setDiscountValueStr(type === "fixed" ? ((job.discountValue ?? 0) / 100).toFixed(2) : String(job.discountValue ?? 0));
    setTaxRateValueStr(String(Number(jobTaxRate.toFixed(4))));
    setPricingOpen(true);
  }

  async function savePricing() {
    if (!job) return;
    if (editableExtraCharges.some((charge) => !charge.description || charge.amountMinor <= 0)) {
      notify("Every extra charge needs a description and positive amount.", "error");
      return;
    }
    const discountValue = Number(discountValueStr);
    const taxRate = Number(taxRateValueStr);
    if (!Number.isFinite(discountValue) || discountValue < 0 || (discountType === "percent" && discountValue > 100)) {
      notify("Enter a valid discount.", "error");
      return;
    }
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      notify("Enter a tax rate between 0% and 100%.", "error");
      return;
    }
    if (discountType === "fixed" && toMinor(discountValueStr) > livePricingTotals.adjustedSubtotalMinor) {
      notify("The fixed discount cannot exceed the adjusted subtotal.", "error");
      return;
    }
    if (livePricingTotals.totalMinor <= 0) {
      notify("The discount must leave a positive invoice total.", "error");
      return;
    }
    setPricingSaving(true);
    try {
      await updateDocById("jobCards", id, {
        extraCharges: livePricingTotals.extraCharges,
        discountType: livePricingTotals.discountType,
        discountValue: livePricingTotals.discountValue,
        discountMinor: livePricingTotals.discountMinor,
        taxRatePercent: livePricingTotals.taxRatePercent,
        subtotalMinor: livePricingTotals.baseSubtotalMinor,
        taxMinor: livePricingTotals.taxMinor,
        totalMinor: livePricingTotals.totalMinor,
      });
      notify("Invoice pricing saved. It will be locked when you generate the invoice.");
      setPricingOpen(false);
    } catch {
      notify("Could not save invoice pricing.", "error");
    } finally {
      setPricingSaving(false);
    }
  }

async function changeStatus(status: JobStatus) {

  try {

    const update: Partial<JobCard> = {
      status
    };


if (status === "delivered") {

  if (!completionNotes.trim()) {
    notify(
      "Completion notes are required before marking the job as delivered.",
      "error"
    );
    return;
  }

  update.actualEndDate = Timestamp.now();

  update.completionNotes = completionNotes.trim();

}

    await updateDocById(
      "jobCards",
      id,
      update
    );


    notify(
      `Status → ${JOB_STATUS_META[status].label}`
    );


if(status === "delivered"){
  router.push("/dashboard/job-cards/finished-jobs");
}


  } catch {

    notify(
      "Could not update status.",
      "error"
    );

  }

}
  function openLine(kind: "labor" | "part") {
    setLineKind(kind);
    setLineModal(true);
  }

  async function addLine(form: FormData) {
    if (!job) return;
    const kind = lineKind;
    let description = "";
    let unitPriceMinor = 0;
    let partId: string | null = null;
    const quantity = Number(form.get("quantity") || 1);

    if (kind === "part") {
      partId = String(form.get("partId") || "");
      const part = parts.find((p) => p.id === partId);
      if (!part) { notify("Pick a part.", "error"); return; }
      description = part.name;
      unitPriceMinor = part.sellPriceMinor;
    } else {
      description = String(form.get("description") || "").trim();
      unitPriceMinor = toMinor(String(form.get("price") || "0"));
      if (!description) { notify("Describe the labor.", "error"); return; }
    }

    try {
      await createDoc("jobCardLines", job.branchId, {
        jobCardId: id, kind, description, partId, quantity,
        unitPriceMinor, lineTotalMinor: unitPriceMinor * quantity,
      });
      notify("Line added.");
      setLineModal(false);
    } catch {
      notify("Could not add line.", "error");
    }
  }

  async function removeLine(lineId: string) {
    try {
      await deleteDocById("jobCardLines", lineId);
      notify("Line removed.");
    } catch {
      notify("Could not remove line.", "error");
    }
  }

  async function generateInvoice() {
    if (!job) return;
    if (lines.length === 0) { notify("Add at least one line before invoicing.", "error"); return; }
    setInvoicing(true);
    try {
      const invoiceId = await generateInvoiceClient(id);
      notify("Invoice generated.");
      router.push(`/dashboard/billing/${invoiceId}`);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "";
      notify(msg || "Could not generate invoice.", "error");
    } finally {
      setInvoicing(false);
    }
  }

  if (loading) return <CenterSpinner label="Loading job card…" />;
  if (!job)
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="Job card not found" />
      </div>
    );

const techCount = (job.assignedTechnicianIds || []).length;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <button
        onClick={() => router.push("/dashboard/job-cards")}
        className="flex items-center gap-2 text-sm text-ink-soft transition hover:text-burgundy-600"
      >
        <ArrowLeft size={16} /> All job cards
      </button>

      {/* Header */}
      <div className="card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Badge tone={JOB_STATUS_META[job.status].tone}>
              {JOB_STATUS_META[job.status].label}
            </Badge>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">
              {job.complaint}
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
              <span className="flex items-center gap-1.5">
 <Wrench size={14}/>
 {serviceNames(job.serviceTypeIds)}
</span>
              {customer && (
                <Link href={`/dashboard/customers/${job.customerId}`} className="flex items-center gap-1.5 hover:text-burgundy-600">
                  <User size={14} /> {customer.displayName}
                </Link>
              )}
              {vehicle && (
                <Link href={`/dashboard/vehicles/${job.vehicleId}`} className="flex items-center gap-1.5 hover:text-burgundy-600">
                  <Car size={14} /> {vehicle.make} {vehicle.model} · {vehicle.plateNumber}
                </Link>
              )}
            </div>
          </div>
          {!readOnly && (
<button
onClick={()=>{
 setEditCustomer(job.customerId || "");
 setEditVehicle(job.vehicleId || "");
 setEditServices(job.serviceTypeIds || []);
 setEditTechnicians(job.assignedTechnicianIds || []);

 setEditScheduledDate(
   job.scheduledDate
   ? job.scheduledDate.toDate().toISOString().split("T")[0]
   : ""
 );

 setEditOpen(true);
}}
className="btn-ghost"
>
 Edit
</button>
)}
          {canEditJob && !readOnly && (
<button 
onClick={() => setDeleteOpen(true)} 
className="btn-ghost shrink-0 px-3 py-2 text-xs"
>
<Trash2 size={15} /> Delete
</button>
)}
        </div>
      </div>

      {/* ── Guided "Next steps" action bar ─────────────────────────────── */}
      {!readOnly &&
 !job.invoiceId &&
 (canEditLines || canAssign || canDoFinancial) && (
        <div className="rounded-2xl border border-burgundy-200 bg-burgundy-50/60 p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-burgundy-600 text-xs font-bold text-white">
              →
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">What&apos;s next?</p>
              <p className="text-xs text-ink-soft">Build this job card, then invoice it.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {canEditLines && (
              <button onClick={() => openLine("part")} className="flex flex-col items-start gap-1.5 rounded-xl border border-line bg-white p-3 text-left transition hover:border-burgundy-300 hover:shadow-soft">
                <Package size={17} className="text-burgundy-600" />
                <span className="text-[13px] font-semibold text-ink">Add Parts</span>
                <span className="text-[11px] text-ink-faint">From inventory</span>
              </button>
            )}
            {canDoFinancial && (
              <button onClick={openPricing} className="flex flex-col items-start gap-1.5 rounded-xl border border-line bg-white p-3 text-left transition hover:border-burgundy-300 hover:shadow-soft">
                <Pencil size={17} className="text-burgundy-600" />
                <span className="text-[13px] font-semibold text-ink">Pricing &amp; tax</span>
                <span className="text-[11px] text-ink-faint">Before invoicing</span>
              </button>
            )}
            {canEditLines && (
              <button onClick={() => openLine("labor")} className="flex flex-col items-start gap-1.5 rounded-xl border border-line bg-white p-3 text-left transition hover:border-burgundy-300 hover:shadow-soft">
                <Wrench size={17} className="text-burgundy-600" />
                <span className="text-[13px] font-semibold text-ink">Add Labor</span>
                <span className="text-[11px] text-ink-faint">Work charges</span>
              </button>
            )}
            {canDoFinancial && (
              <button onClick={generateInvoice} disabled={invoicing || lines.length === 0}
                className="flex flex-col items-start gap-1.5 rounded-xl border border-line bg-white p-3 text-left transition hover:border-burgundy-300 hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-50">
                <Receipt size={17} className="text-burgundy-600" />
                <span className="text-[13px] font-semibold text-ink">
                  {invoicing ? "Generating…" : "Invoice"}
                </span>
                <span className="text-[11px] text-ink-faint">
                  {lines.length === 0 ? "Add a line first" : "Generate & lock"}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Status pipeline */}
      <div className="card p-6">
        <p className="mb-3 text-sm font-semibold text-ink">Status</p>
        <div className="flex flex-wrap gap-2">
          {JOB_STATUS_ORDER.map((s) => {
            const active = job.status === s;
const disabled = readOnly || !(canEditJob || isTech);           return (
              <button
                key={s}
                disabled={disabled}
                onClick={() => changeStatus(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "bg-burgundy-600 text-white shadow-soft"
                    : "border border-line bg-surface text-ink-soft hover:border-burgundy-300 hover:text-burgundy-600 disabled:cursor-not-allowed disabled:opacity-50"
                }`}
              >
                {JOB_STATUS_META[s].label}
              </button>
            );
          })}
        </div>
      </div>

      {!readOnly && (
  <div className="mt-5">
    <Field label="Completion Notes">
      <textarea
        className="input-luxe"
        rows={4}
        value={completionNotes}
        onChange={(e)=>setCompletionNotes(e.target.value)}
        placeholder="Describe completed work, repairs performed, replaced parts, customer notes..."
      />
    </Field>
  </div>
)}

      {/* Vehicle Check-in Inspection */}
      <VehicleCheckIn job={job} jobId={id} canEdit={canEditLines} />

      {/* Before & After Photos */}
      <JobPhotos job={job} jobId={id} canEdit={canEditLines} />

      {/* Assigned technicians */}
      <div className="card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Users size={16} className="text-burgundy-500" /> Assigned technicians
          </h2>
          {canAssign && (
            <button onClick={() => setAssignOpen(true)} className="btn-ghost px-3 py-1.5 text-xs">
              <Plus size={14} /> Assign
            </button>
          )}
        </div>
        {techCount === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface-muted/40 px-5 py-5 text-center text-sm text-ink-soft">
            No technician assigned yet. A technician only sees jobs assigned to them.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(job.assignedTechnicianIds || []).map((uid) => {
              const t = technicians.find((x) => x.uid === uid);
              return (
                <span key={uid} className="inline-flex items-center gap-2 rounded-full bg-burgundy-50 px-3 py-1.5 text-sm text-burgundy-700">
                  <User size={13} /> {t ? t.name : uid.slice(0, 8)}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Labor &amp; Parts</h2>
          {canEditLines && !job.invoiceId && (
            <div className="flex gap-2">
              <button onClick={() => openLine("labor")} className="btn-ghost px-3 py-1.5 text-xs">
                <Wrench size={14} /> Labor
              </button>
              <button onClick={() => openLine("part")} className="btn-ghost px-3 py-1.5 text-xs">
                <Package size={14} /> Part
              </button>
            </div>
          )}
        </div>

        {lines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-surface-muted/40 px-5 py-8 text-center text-sm text-ink-soft">
            No lines yet. Use <span className="font-medium text-ink">Add Parts</span> or{" "}
            <span className="font-medium text-ink">Add Labor</span> above to build the estimate.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-2.5">Item</th>
                  <th className="px-4 py-2.5 text-center">Qty</th>
                  <th className="px-4 py-2.5 text-right">Unit</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((l) => (
                  <tr key={l.id} className="bg-white">
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2 text-ink">
                        {l.kind === "part" ? (
                          <Package size={14} className="text-burgundy-400" />
                        ) : (
                          <Wrench size={14} className="text-burgundy-400" />
                        )}
                        {l.description}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-ink-soft">{l.quantity}</td>
                    <td className="px-4 py-2.5 text-right text-ink-soft">{formatMoney(l.unitPriceMinor)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-ink">{formatMoney(l.lineTotalMinor)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {canEditLines && !job.invoiceId && (
                        <button onClick={() => setConfirmDelete(l.id)} className="text-ink-faint transition hover:text-burgundy-600" aria-label="Remove">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Line subtotal; invoice adjustments are shown separately below. */}
        <div className="mt-5 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between text-ink-soft">
              <span>Labor &amp; parts subtotal</span><span>{formatMoney(totals.baseSubtotalMinor)}</span>
            </div>
          </div>
        </div>

        
      </div>
      {job.completionNotes && (
  <div className="mt-6 rounded-xl border border-line p-4">
    <h3 className="font-semibold mb-2">Completion Notes</h3>
    <p className="whitespace-pre-wrap text-sm text-ink-soft">
      {job.completionNotes}
    </p>
  </div>
)}

      {/* Invoice pricing */}
      <div className="card p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Invoice pricing</h2>
            <p className="mt-1 text-xs text-ink-soft">
              {job.invoiceId
                ? "This pricing was frozen when the invoice was generated."
                : "Set extra charges, a discount and tax before generating the invoice."}
            </p>
          </div>
          {canDoFinancial && !job.invoiceId && (
            <button onClick={openPricing} className="btn-ghost shrink-0 px-3 py-2 text-xs">
              <Pencil size={15} /> Adjust pricing
            </button>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between text-ink-soft"><span>Labor &amp; parts</span><span>{formatMoney(totals.baseSubtotalMinor)}</span></div>
            {totals.extraChargesTotalMinor > 0 && <div className="flex justify-between text-ink-soft"><span>Extra charges</span><span>+ {formatMoney(totals.extraChargesTotalMinor)}</span></div>}
            {totals.discountMinor > 0 && <div className="flex justify-between text-emerald-700"><span>Discount{totals.discountType === "percent" ? ` (${totals.discountValue}%)` : ""}</span><span>− {formatMoney(totals.discountMinor)}</span></div>}
            <div className="flex justify-between text-ink-soft"><span>Tax ({Number(totals.taxRatePercent.toFixed(2))}%)</span><span>{formatMoney(totals.taxMinor)}</span></div>
            <div className="flex justify-between border-t border-line pt-2 text-lg font-bold text-ink"><span>Total</span><span>{formatMoney(totals.totalMinor)}</span></div>
          </div>
        </div>
      </div>

      {/* Invoice status footer */}
      <div className="card flex flex-col items-center justify-between gap-4 p-5 sm:flex-row">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {job.invoiceId ? "Invoice generated" : "Ready to invoice?"}
          </h3>
          <p className="text-xs text-ink-soft">
            {job.invoiceId
              ? "This job has been invoiced. View it in Billing."
              : "Review pricing, then generate an invoice. It cannot be changed afterwards."}
          </p>
        </div>
        {job.invoiceId ? (
          <Link href={`/dashboard/billing/${job.invoiceId}`} className="btn-ghost">
            <Receipt size={16} /> View invoice
          </Link>
        ) : (
          canDoFinancial && (
            <button onClick={generateInvoice} disabled={invoicing || lines.length === 0} className="btn-primary">
              {invoicing ? "Generating…" : "Generate invoice"} <ArrowRight size={16} />
            </button>
          )
        )}
      </div>

      {/* Add line modal */}
      <Modal open={lineModal} onClose={() => setLineModal(false)} title={lineKind === "part" ? "Add Part" : "Add Labor"}>
        <form onSubmit={(e) => { e.preventDefault(); addLine(new FormData(e.currentTarget)); }} className="space-y-4">
          {lineKind === "part" ? (
            <Field label="Part" required hint={parts.length === 0 ? "No parts in inventory yet — add some in Inventory." : "Price pulls from the catalogue sell price."}>
              <select name="partId" className="input-luxe">
                <option value="" disabled selected>Select a part…</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatMoney(p.sellPriceMinor)} ({p.quantityOnHand} in stock)
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Description" required>
                <input name="description" className="input-luxe" placeholder="e.g. Front brake pad replacement" />
              </Field>
              <Field label="Unit price (LKR)" required>
                <input name="price" className="input-luxe" placeholder="0.00" inputMode="decimal" />
              </Field>
            </>
          )}
          <Field label="Quantity" required>
            <input name="quantity" type="number" min={1} defaultValue={1} className="input-luxe" />
          </Field>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setLineModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Add line</button>
          </div>
        </form>
      </Modal>

      <Modal open={pricingOpen} onClose={() => setPricingOpen(false)} title="Invoice pricing" size="lg">
        <div className="space-y-6">
          <p className="text-sm text-ink-soft">These choices apply when this job is invoiced. They are locked after the invoice is generated.</p>
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div><p className="text-sm font-semibold text-ink">Extra charges</p><p className="text-xs text-ink-faint">Add charges not included in labor or parts.</p></div>
              <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={() => setCharges((current) => [...current, { description: "", amount: "" }])}><Plus size={15} /> Add charge</button>
            </div>
            {charges.length === 0 ? <div className="rounded-xl border border-dashed border-line bg-surface-muted/40 px-4 py-5 text-center text-sm text-ink-faint">No extra charges added.</div> : <div className="space-y-3">
              {charges.map((charge, index) => <div key={index} className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
                <Field label="Description" required><input className="input-luxe" placeholder="Special cleaning" value={charge.description} onChange={(event) => setCharges((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /></Field>
                <Field label="Amount (LKR)" required><input className="input-luxe" inputMode="decimal" placeholder="0.00" value={charge.amount} onChange={(event) => setCharges((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} /></Field>
                <button type="button" className="btn-ghost mb-0.5 h-10 w-10 justify-center p-0 text-rose-500" aria-label={`Remove charge ${index + 1}`} onClick={() => setCharges((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={17} /></button>
              </div>)}
            </div>}
          </div>
          <div className="border-t border-line pt-5"><p className="mb-3 text-sm font-semibold text-ink">Discount</p><div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]"><div className="grid grid-cols-2 rounded-xl border border-line bg-surface-muted p-1">{(["percent", "fixed"] as DiscountType[]).map((type) => <button key={type} type="button" onClick={() => { setDiscountType(type); setDiscountValueStr("0"); }} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${discountType === type ? "bg-white text-burgundy-700 shadow-soft" : "text-ink-soft"}`}>{type === "percent" ? "Percent (%)" : "Fixed value"}</button>)}</div><Field label={discountType === "percent" ? "Percentage" : "Amount (LKR)"}><input className="input-luxe" inputMode="decimal" min="0" max={discountType === "percent" ? "100" : undefined} value={discountValueStr} onChange={(event) => setDiscountValueStr(event.target.value)} /></Field></div></div>
          <div className="border-t border-line pt-5"><Field label="Tax rate (%)" hint={branch ? `Branch default is ${branch.taxRatePercent}%. You can change it for this job before invoicing.` : "Set the applicable tax rate before invoicing."}><input className="input-luxe max-w-xs" inputMode="decimal" min="0" max="100" value={taxRateValueStr} onChange={(event) => setTaxRateValueStr(event.target.value)} /></Field></div>
          <div className="rounded-2xl border border-burgundy-100 bg-burgundy-50/50 p-5"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-burgundy-700">Invoice total</p><div className="space-y-2 text-sm"><div className="flex justify-between text-ink-soft"><span>Labor &amp; parts</span><span>{formatMoney(livePricingTotals.baseSubtotalMinor)}</span></div><div className="flex justify-between text-ink-soft"><span>Extra charges</span><span>+ {formatMoney(livePricingTotals.extraChargesTotalMinor)}</span></div><div className="flex justify-between text-emerald-700"><span>Discount</span><span>− {formatMoney(livePricingTotals.discountMinor)}</span></div><div className="flex justify-between text-ink-soft"><span>Tax ({Number(livePricingTotals.taxRatePercent.toFixed(2))}%)</span><span>{formatMoney(livePricingTotals.taxMinor)}</span></div><div className="flex justify-between border-t border-burgundy-100 pt-2 text-lg font-semibold text-burgundy-700"><span>Final total</span><span>{formatMoney(livePricingTotals.totalMinor)}</span></div></div></div>
          <div className="flex justify-end gap-3"><button type="button" className="btn-ghost" onClick={() => setPricingOpen(false)}>Cancel</button><button type="button" className="btn-primary" onClick={savePricing} disabled={pricingSaving}>{pricingSaving ? "Saving…" : "Save pricing"}</button></div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && removeLine(confirmDelete)}
        title="Remove line?"
        message="This line will be removed from the job card."
        confirmLabel="Remove"
        danger
      />

      {/* Assign technicians modal */}
      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign technicians">
        {technicians.length === 0 ? (
          <p className="rounded-xl bg-surface-muted px-4 py-6 text-center text-sm text-ink-soft">
            No technician accounts found. Create a staff member with the Technician role in Users &amp; Roles first.
          </p>
        ) : (
          <div className="space-y-2">
            {technicians.map((t) => {
              const assigned = (job.assignedTechnicianIds || []).includes(t.uid);
              return (
                <button key={t.uid} onClick={() => toggleTechnician(t.uid)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-sm transition ${
                    assigned ? "border-burgundy-300 bg-burgundy-50 text-burgundy-700" : "border-line bg-surface text-ink-soft hover:border-burgundy-300"
                  }`}>
                  <span className="flex items-center gap-2"><User size={15} /> {t.name}</span>
                  {assigned && <Check size={16} className="text-burgundy-600" />}
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-5 flex justify-end">
          <button onClick={() => setAssignOpen(false)} className="btn-primary">Done</button>
        </div>
      </Modal>

<Modal
 open={editOpen}
 onClose={()=>setEditOpen(false)}
 title="Edit Job Card"
>

<form
onSubmit={(e)=>{
 e.preventDefault();
 updateJob(new FormData(e.currentTarget));
}}
className="space-y-4"
>

<Field label="Services">

<select
multiple
value={editServices}
onChange={(e)=>
setEditServices(
Array.from(
e.target.selectedOptions,
o=>o.value
)
)
}
className="input-luxe h-32"
>


{services.map(s=>(

<option key={s.id} value={s.id}>
{s.name}
</option>

))}


</select>

</Field>

<Field label="Technicians">

<select
multiple
value={editTechnicians}
onChange={(e)=>
setEditTechnicians(
Array.from(
e.target.selectedOptions,
o=>o.value
)
)
}
className="input-luxe h-32"
>


{technicians.map(t=>(

<option key={t.uid} value={t.uid}>
{t.name}
</option>

))}


</select>

</Field>

<Field label="Scheduled Date">

<input
  name="scheduledDate"
  type="date"
  min={today}
  value={editScheduledDate}
  onChange={(e)=>setEditScheduledDate(e.target.value)}
  className="input-luxe"
/>

</Field>

<Field label="Customer">

<select
name="customerId"
value={editCustomer}
onChange={(e)=>{
 setEditCustomer(e.target.value);
 setEditVehicle("");
}}
className="input-luxe"
>

<option value="">Select customer</option>

{customers.map(c=>(
<option key={c.id} value={c.id}>
{c.displayName}
</option>
))}

</select>

</Field>

<Field label="Vehicle">

<select
name="vehicleId"
value={editVehicle}
onChange={(e)=>setEditVehicle(e.target.value)}
className="input-luxe"
>

<option value="">
Select vehicle
</option>


{editVehicles.map(v=>(

<option key={v.id} value={v.id}>
{v.make} {v.model} - {v.plateNumber}
</option>

))}


</select>

</Field>

<Field label="Complaint">

<textarea
name="complaint"
defaultValue={job.complaint}
className="input-luxe"
/>

</Field>


<Field label="Start Date">

<input
  name="startDate"
  type="date"
  min={today}
  defaultValue={
    job.startDate
    ? job.startDate.toDate()
      .toISOString()
      .split("T")[0]
    : ""
  }
  className="input-luxe"
/>
</Field>


<Field label="Promised End Date">

<input
  name="promisedEndDate"
  type="date"
  min={today}
  defaultValue={
    job.promisedEndDate
    ? job.promisedEndDate.toDate()
      .toISOString()
      .split("T")[0]
    : ""
  }
  className="input-luxe"
/>
</Field>


<div className="flex justify-end gap-3">

<button
type="button"
onClick={()=>setEditOpen(false)}
className="btn-ghost"
>
Cancel
</button>


<button
type="submit"
className="btn-primary"
>
Save Changes
</button>


</div>


</form>

</Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteJob}
        title="Delete this job card?"
        message="This permanently deletes the job card. This cannot be undone."
        confirmLabel="Delete permanently"
        danger
      />
    </div>
  );
}
