"use client";

import { useState, useMemo, useEffect  } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Timestamp } from "firebase/firestore";
import {
  ClipboardList,
  Plus,
  LayoutGrid,
  List as ListIcon,
  Car,
  User,
  CalendarClock,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { useCollection } from "@/lib/useCollection";
import { createDoc } from "@/lib/db-write";
import {
  JobCard,
  Customer,
  Vehicle,
  ServiceType,
  JobStatus,
  JOB_STATUS_META,
  JOB_STATUS_ORDER,
} from "@/lib/models";
import { formatMoney, formatDate } from "@/lib/format";

import {
  PageHeader,
  Modal,
  Field,
  TableSkeleton,
  EmptyState,
  Badge,
  DataTable,
  Column,
  FilterChips,
  SearchInput,
  useToast,
} from "@/components/ui";

export default function JobCardsPage() {
  const { branchId, role } = useAuth();
  const router = useRouter();
  const today = new Date().toISOString().split("T")[0];
  const { data: allJobs, loading, error } = useCollection<JobCard>("jobCards");
const jobs =
(
  role === "technician"
    ? allJobs.filter((j) =>
        (j.assignedTechnicianIds || []).includes(auth.currentUser?.uid ?? "")
      )
    : allJobs
).filter(
  (j) => j.status !== "delivered" && !j.archived
);
  const { data: customers } = useCollection<Customer>("customers");
  const { data: vehicles } = useCollection<Vehicle>("vehicles");
  const { data: services } = useCollection<ServiceType>("services");
  const { data: technicians } = useCollection<any>("users");

  const availableTechnicians = technicians.filter(
  (u) =>
    u.role === "technician" &&
    !u.archived
);
const technicianJobCount = (technicianId: string) => {
  return jobs.filter(
    (job) =>
      job.assignedTechnicianIds?.includes(technicianId) &&
      job.status !== "delivered" &&
      !job.archived
  ).length;
};
  const { notify } = useToast();

  const [view, setView] = useState<"board" | "list">("board");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
const [serviceOpen, setServiceOpen] = useState(false);

const [selectedTechnicians, setSelectedTechnicians] = useState<string[]>([]);
const [technicianOpen, setTechnicianOpen] = useState(false);

const [startDate, setStartDate] = useState("");
const [promisedDate, setPromisedDate] = useState("");

  const canCreate = role === "owner" || role === "manager" || role === "advisor";

  const customerName = (id: string) =>
    customers.find((c) => c.id === id)?.displayName ?? "—";
  const vehicleLabel = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.make} ${v.model} · ${v.plateNumber}` : "—";
  };
  const serviceNames = (ids:string[]) =>
    
 services
 .filter(s=>ids?.includes(s.id))
 .map(s=>s.name)
 .join(", ");

 const technicianNames = (ids: string[] = []) =>
  technicians
    .filter((t) => ids.includes(t.id))
    .map((t) => t.displayName || t.email)
    .join(", ");

  const modalVehicles = useMemo(
    () => vehicles.filter((v) => v.customerId === selectedCustomer),
    [vehicles, selectedCustomer]
  );

  // Search across complaint, customer name and vehicle label.
  const searched = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.complaint?.toLowerCase().includes(q) ||
        customerName(j.customerId).toLowerCase().includes(q) ||
        vehicleLabel(j.vehicleId).toLowerCase().includes(q)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, search, customers, vehicles]);

  const byStatus = useMemo(() => {
    const map: Record<JobStatus, (JobCard & { id: string })[]> = {
      booked: [],
      in_progress: [],
      awaiting_parts: [],
      qc: [],
      ready: [],
      delivered: [],
    };
    searched.forEach((j) => map[j.status]?.push(j));
    return map;
  }, [searched]);

  const listRows = useMemo(
    () =>
      statusFilter === "all"
        ? searched
        : searched.filter((j) => j.status === statusFilter),
    [searched, statusFilter]
  );

  const columns: Column<JobCard & { id: string }>[] = [
    {
      key: "complaint",
      header: "Complaint",
      sortValue: (j) => j.complaint?.toLowerCase() ?? "",
      cell: (j) => (
        <span className="font-medium text-ink group-hover:text-burgundy-600 line-clamp-1">
          {j.complaint}
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      sortValue: (j) => customerName(j.customerId).toLowerCase(),
      hideBelow: "sm",
      cell: (j) => (
        <span className="flex items-center gap-1.5 text-ink-soft">
          <User size={13} className="text-ink-faint" /> {customerName(j.customerId)}
        </span>
      ),
    },
    {
      key: "vehicle",
      header: "Vehicle",
      hideBelow: "lg",
      cell: (j) => (
        <span className="flex items-center gap-1.5 text-ink-soft">
          <Car size={13} className="text-ink-faint" /> {vehicleLabel(j.vehicleId)}
        </span>
      ),
    },
    {
 key:"service",
 header:"Service",
 cell:(j)=>(
   <span className="text-ink-soft">
     {serviceNames(j.serviceTypeIds)}
   </span>
 )
},

{
  key: "technician",
  header: "Technician",
  cell: (j) => (
    <span className="text-ink-soft">
      {technicianNames(j.assignedTechnicianIds)}
    </span>
  ),
},

{
  key: "start",
  header: "Start Date",
  cell: (j) => (
    <span>
      {j.startDate ? formatDate(j.startDate) : "-"}
    </span>
  ),
},

{
  key: "promised",
  header: "Promised End",
  cell: (j) => (
    <div className="flex items-center gap-2">
      <span>
        {j.promisedEndDate
          ? formatDate(j.promisedEndDate)
          : "-"}
      </span>

      {j.promisedEndDate &&
        j.promisedEndDate.toDate() < new Date() && (
          <span className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
            Overdue
          </span>
        )}
    </div>
  ),
},
    {
      key: "status",
      header: "Status",
      sortValue: (j) => JOB_STATUS_ORDER.indexOf(j.status),
      cell: (j) => (
        <Badge tone={JOB_STATUS_META[j.status].tone}>
          {JOB_STATUS_META[j.status].label}
        </Badge>
      ),
    },
    {
      key: "date",
      header: "Opened",
      sortValue: (j) => j.createdAt?.toMillis?.() ?? 0,
      hideBelow: "md",
      cell: (j) => (
        <span className="text-xs text-ink-faint">{formatDate(j.createdAt)}</span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortValue: (j) => j.totalMinor,
      cell: (j) => (
        <span className="font-medium text-ink">{formatMoney(j.totalMinor)}</span>
      ),
    },
  ];


  function isPastDate(date: string) {
  if (!date) return false;

  const selected = new Date(date);
  const today = new Date();

  today.setHours(0, 0, 0, 0);
  selected.setHours(0, 0, 0, 0);

  return selected < today;
}

async function handleCreate(form: FormData) {
  if (!branchId) return;

  setSaving(true);

  const start = String(form.get("startDate") || "");
  const promised = String(form.get("promisedEndDate") || "");

  if (isPastDate(start)) {
  notify(
    "Start date cannot be a past date.",
    "error"
  );
  setSaving(false);
  return;
}

if (isPastDate(promised)) {
  notify(
    "Promised end date cannot be a past date.",
    "error"
  );
  setSaving(false);
  return;
}


if (start && promised) {
  const startDate = new Date(start);
  const promisedDate = new Date(promised);

  if (promisedDate < startDate) {
    notify(
      "Promised end date cannot be before start date.",
      "error"
    );
    setSaving(false);
    return;
  }
}

  const payload = {
    customerId: String(form.get("customerId") || ""),
    vehicleId: String(form.get("vehicleId") || ""),

    complaint: String(form.get("complaint") || "").trim(),

    serviceTypeIds: selectedServices,

    assignedTechnicianIds: selectedTechnicians,

    startDate: start
      ? Timestamp.fromDate(new Date(start))
      : null,

    promisedEndDate: promised
      ? Timestamp.fromDate(new Date(promised))
      : null,

    status: "booked" as JobStatus,

    subtotalMinor: 0,
    taxMinor: 0,
    totalMinor: 0,

    invoiceId: null,

    scheduledDate: null,
  };


  if (
    !payload.customerId ||
    !payload.vehicleId ||
    !payload.complaint ||
    payload.serviceTypeIds.length === 0
  ) {
    notify(
      "Customer, vehicle, service and complaint are required.",
      "error"
    );

    setSaving(false);
    return;
  }


  try {

    const ref = await createDoc(
      "jobCards",
      branchId,
      payload
    );


    notify("Job card created");

    setModalOpen(false);
    setSelectedCustomer("");
    setSelectedServices([]);

    router.push(
      `/dashboard/job-cards/${ref.id}`
    );


  } catch(error){

    console.error(error);

    notify(
      "Could not create job card.",
      "error"
    );

  } finally {

    setSaving(false);

  }
}

function calculatePromisedDate(date: string) {
  if (!date || selectedServices.length === 0) return "";

  const totalDays = selectedServices.reduce((sum, id) => {
    const service = services.find((s) => s.id === id);

    return sum + (service?.estimatedDays ?? 0);
  }, 0);

  const d = new Date(date);

  d.setDate(d.getDate() + totalDays);

  return d.toISOString().split("T")[0];
}

useEffect(() => {
  if (startDate) {
    setPromisedDate(
      calculatePromisedDate(startDate)
    );
  }
}, [selectedServices]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Operations"
        title="Job Cards"
        icon={ClipboardList}
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-line bg-surface p-1">
              <button
                onClick={() => setView("board")}
                className={`rounded-lg p-2 transition ${
                  view === "board"
                    ? "bg-burgundy-600 text-white"
                    : "text-ink-soft hover:text-burgundy-600"
                }`}
                aria-label="Board view"
              >
                <LayoutGrid size={18} />
              </button>
              <button
                onClick={() => setView("list")}
                className={`rounded-lg p-2 transition ${
                  view === "list"
                    ? "bg-burgundy-600 text-white"
                    : "text-ink-soft hover:text-burgundy-600"
                }`}
                aria-label="List view"
              >
                <ListIcon size={18} />
              </button>
            </div>
            {canCreate && (
              <button onClick={() => setModalOpen(true)} className="btn-primary">
                <Plus size={18} /> New Job
              </button>
            )}
          </div>
        }
      />

      {/* Search + status filters */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {view === "list" && jobs.length > 0 ? (
          <FilterChips
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All", count: searched.length },
              ...JOB_STATUS_ORDER.filter(
    (s) => s !== "delivered"
).map((s) => ({
                value: s,
                label: JOB_STATUS_META[s].label,
                count: byStatus[s].length,
              })),
            ]}
          />
        ) : (
          <span />
        )}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search complaint, customer or vehicle…"
          className="w-full sm:max-w-xs"
        />
      </div>

      {!loading && jobs.length > 0 && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-burgundy-100 bg-burgundy-50/50 px-4 py-3 text-sm text-ink-soft">
          <ClipboardList size={16} className="shrink-0 text-burgundy-600" />
          Select a job card to add work, set pricing and generate its invoice.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl bg-burgundy-50 px-4 py-3 font-sans text-sm text-burgundy-600">
          {error}
        </div>
      )}

      {loading ? (
        view === "list" ? (
          <TableSkeleton cols={6} />
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {JOB_STATUS_ORDER.map((s) => (
              <div key={s} className="w-72 shrink-0 space-y-2">
                <TableSkeleton cols={1} rows={3} />
              </div>
            ))}
          </div>
        )
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No job cards yet"
          hint="Open a job card when a vehicle comes in for work."
          action={
            canCreate && (
              <button onClick={() => setModalOpen(true)} className="btn-primary">
                <Plus size={18} /> New Job
              </button>
            )
          }
        />
      ) : searched.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No matches"
          hint="No job cards match your search."
        />
      ) : view === "board" ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {JOB_STATUS_ORDER.map((status) => (
            <div key={status} className="w-72 shrink-0">
              <div className="mb-3 flex items-center justify-between px-1">
                <Badge tone={JOB_STATUS_META[status].tone}>
                  {JOB_STATUS_META[status].label}
                </Badge>
                <span className="font-sans text-xs text-ink-faint">
                  {byStatus[status].length}
                </span>
              </div>
              <div className="space-y-2">
                {byStatus[status].map((j) => (
                  <motion.div
                    key={j.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Link
                      href={`/dashboard/job-cards/${j.id}`}
                      className="card block cursor-pointer p-4 transition hover:border-burgundy-300 hover:shadow-luxe focus:outline-none focus:ring-2 focus:ring-burgundy-300"
                    >
                      <p className="line-clamp-2 font-sans text-sm font-medium text-ink">
                        {j.complaint}
                      </p>
                      <p className="mt-1 text-xs text-burgundy-600">
 {serviceNames(j.serviceTypeIds)}
</p>
<p className="mt-1 text-xs text-ink-soft">
    👨‍🔧 {technicianNames(j.assignedTechnicianIds)}
</p>

<p className="mt-1 text-xs text-ink-soft">
    Start: {j.startDate ? formatDate(j.startDate) : "-"}
</p>

<p className="mt-1 text-xs text-ink-soft">
    Due: {j.promisedEndDate ? formatDate(j.promisedEndDate) : "-"}
</p>

{j.promisedEndDate &&
 j.promisedEndDate.toDate() < new Date() && (
    <span className="mt-2 inline-block rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
        Overdue
    </span>
)}
                      <div className="mt-2.5 space-y-1 font-sans text-xs text-ink-soft">
                        <p className="flex items-center gap-1.5">
                          <User size={12} /> {customerName(j.customerId)}
                        </p>
                        <p className="flex items-center gap-1.5">
                          <Car size={12} /> {vehicleLabel(j.vehicleId)}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                        <span className="font-sans text-xs text-ink-faint">
                          {formatDate(j.createdAt)}
                        </span>
                        <span className="font-sans text-sm font-semibold text-burgundy-600">
                          {formatMoney(j.totalMinor)}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs font-semibold text-burgundy-600">
                        <span>Open job card</span><ArrowRight size={14} />
                      </div>
                    </Link>
                  </motion.div>
                ))}
                {byStatus[status].length === 0 && (
                  <div className="rounded-xl border border-dashed border-line py-6 text-center font-sans text-xs text-ink-faint">
                    Empty
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <DataTable
          rows={listRows}
          columns={columns}
          initialSort={{ key: "date", dir: "desc" }}
          onRowClick={(j) => router.push(`/dashboard/job-cards/${j.id}`)}
          emptyState={
            <EmptyState
              icon={ClipboardList}
              title="No matching job cards"
              hint="Try a different status filter."
            />
          }
        />
      )}

      <Modal
  open={modalOpen}
  onClose={() => {
    setModalOpen(false);
    setSelectedCustomer("");
  }}
  title="New Job Card"
  size="lg"
>
        <form
  onSubmit={(e) => {
    e.preventDefault();
    handleCreate(new FormData(e.currentTarget));
  }}
  className="max-h-[75vh] overflow-y-auto space-y-4 pr-2"
>
          <Field label="Customer" required>
            <select
              name="customerId"
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="input-luxe"
            >
              <option value="" disabled>
                Select a customer…
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} · {c.phone}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Vehicle"
            required
            hint={
              selectedCustomer && modalVehicles.length === 0
                ? "This customer has no vehicles — add one first."
                : undefined
            }
          >
          <Field label="Service Type(s)" required>

<div className="relative">

<button
type="button"
onClick={()=>setServiceOpen(!serviceOpen)}
className="input-luxe text-left flex justify-between items-center"
>

<span>
{
selectedServices.length === 0
? "Select services..."
: `${selectedServices.length} service(s) selected`
}
</span>

<span>▼</span>

</button>


{serviceOpen && (

<div className="absolute z-20 mt-2 w-full rounded-xl border border-line bg-white p-3 shadow-lg">

{services
.filter(s=>s.active)
.map(service=>(

<label
key={service.id}
className="flex items-center gap-3 p-2 hover:bg-surface-muted rounded-lg cursor-pointer"
>

<input
type="checkbox"
checked={selectedServices.includes(service.id)}
onChange={()=>{

setSelectedServices(prev=>

prev.includes(service.id)

?

prev.filter(id=>id!==service.id)

:

[...prev,service.id]

);

}}
/>


<span>

{service.name}

<span className="text-xs text-ink-faint ml-2">
({service.estimatedDays} days)
</span>

</span>


</label>

))}

</div>

)}

</div>

</Field>

<Field label="Technician(s)">

<div className="relative">


<button
type="button"
onClick={()=>setTechnicianOpen(!technicianOpen)}
className="input-luxe text-left flex justify-between items-center"
>

<span>

{
selectedTechnicians.length===0

?

"Select technicians..."

:

`${selectedTechnicians.length} technician(s) selected`

}

</span>

<span>▼</span>

</button>



{technicianOpen && (

<div className="absolute z-20 mt-2 w-full rounded-xl border border-line bg-white p-3 shadow-lg">


{
availableTechnicians.map(t=>(


<label
key={t.id}
className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-muted cursor-pointer"
>


<input
type="checkbox"
checked={selectedTechnicians.includes(t.id)}

onChange={()=>{

setSelectedTechnicians(prev=>

prev.includes(t.id)

?

prev.filter(id=>id!==t.id)

:

[...prev,t.id]

)

}}

/>


<span className="flex items-center justify-between w-full">
  <span>
    {t.displayName || t.email}
  </span>

  <span className="text-xs text-ink-faint">
    ({technicianJobCount(t.id)})
  </span>
</span>

</label>


))
}


</div>

)}

</div>

</Field>

<Field label="Start date">

<input
  name="startDate"
  type="date"
  min={today}
  className="input-luxe"
  value={startDate}
  onChange={(e) => {
    const value = e.target.value;

    setStartDate(value);

    setPromisedDate(
      calculatePromisedDate(value)
    );
  }}
/>

</Field>


<Field label="Promised end date">

<input
  name="promisedEndDate"
  type="date"
  min={startDate || today}
  className="input-luxe"
  value={promisedDate}
/>

</Field>
            <select
              name="vehicleId"
              className="input-luxe"
              disabled={!selectedCustomer}
            >
              <option value="" disabled selected>
                {selectedCustomer ? "Select a vehicle…" : "Pick a customer first"}
              </option>
              {modalVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.make} {v.model} · {v.plateNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Complaint / work requested" required>
            <textarea
              name="complaint"
              rows={3}
              className="input-luxe resize-none"
              placeholder="e.g. Brake noise on front left, service due"
            />
          </Field>
          <Field label="Scheduled date" hint="Optional — shows on the dashboard calendar.">
  <input
    name="scheduledDate"
    type="date"
    min={today}
    className="input-luxe"
  />
</Field>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                setSelectedCustomer("");
              }}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Creating…" : "Create job card"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
