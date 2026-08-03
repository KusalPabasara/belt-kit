"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarCheck2,
  CalendarClock,
  Check,
  CheckCircle2,
  LoaderCircle,
  Inbox,
  MessageSquareText,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { CenterSpinner, EmptyState, useToast } from "@/components/ui";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import attendanceService from "@/lib/services/attendanceService";
import type { Attendance, AttendanceStatus, SerializedTimestamp } from "@/lib/types/attendance";
import type { Employee } from "@/lib/models";
import { SummaryCard } from "./SummaryCard";

type MarkedFilter = "all" | AttendanceStatus;
type DisplayStatus = AttendanceStatus | "not_marked";
type RosterView = "to_mark" | "marked";
type DetailsPurpose = "general" | "leave_reason";

type Props = {
  employees: Employee[];
  initialDate?: string;
  initialEmployeeId?: string;
  editRequest?: { employeeId: string; date: string; nonce: number } | null;
};

const STATUS_OPTIONS: Array<{
  value: AttendanceStatus;
  label: string;
  icon: typeof Check;
  selected: string;
  hover: string;
}> = [
  {
    value: "present",
    label: "Present",
    icon: Check,
    selected: "border-emerald-500 bg-emerald-50 text-emerald-700",
    hover: "hover:border-emerald-300 hover:bg-emerald-50/60 hover:text-emerald-700",
  },
  {
    value: "absent",
    label: "Absent",
    icon: X,
    selected: "border-rose-500 bg-rose-50 text-rose-700",
    hover: "hover:border-rose-300 hover:bg-rose-50/60 hover:text-rose-700",
  },
  {
    value: "on_leave",
    label: "On leave",
    icon: CalendarClock,
    selected: "border-amber-500 bg-amber-50 text-amber-700",
    hover: "hover:border-amber-300 hover:bg-amber-50/60 hover:text-amber-700",
  },
];

const STATUS_BADGES: Record<DisplayStatus, string> = {
  present: "bg-emerald-50 text-emerald-700",
  absent: "bg-rose-50 text-rose-700",
  on_leave: "bg-amber-50 text-amber-700",
  not_marked: "bg-slate-100 text-slate-600",
};

function statusLabel(status: DisplayStatus) {
  if (status === "present") return "Present";
  if (status === "absent") return "Absent";
  if (status === "on_leave") return "On leave";
  return "Not marked";
}

function dateInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function employeeName(employee: Employee) {
  return employee.fullName ?? employee.displayName ?? employee.email;
}

function formatSelectedDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatTimestamp(value?: SerializedTimestamp | string | null) {
  if (!value) return "—";
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  const seconds = value.seconds ?? value._seconds;
  return typeof seconds === "number" ? new Date(seconds * 1000).toLocaleString() : "—";
}

export function MarkAttendance({ employees, initialDate, initialEmployeeId, editRequest }: Props) {
  const { branchId } = useAuth();
  const { notify } = useToast();
  const requestSequence = useRef(0);
  const [timeZone, setTimeZone] = useState("Asia/Colombo");
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? "");
  const [date, setDate] = useState(initialDate ?? dateInTimeZone("Asia/Colombo"));
  const [status, setStatus] = useState<AttendanceStatus | "">("");
  const [note, setNote] = useState("");
  const [records, setRecords] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingEmployeeId, setSavingEmployeeId] = useState<string | null>(null);
  const [rosterView, setRosterView] = useState<RosterView>("to_mark");
  const [markedFilter, setMarkedFilter] = useState<MarkedFilter>("all");
  const [search, setSearch] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [detailsPurpose, setDetailsPurpose] = useState<DetailsPurpose>("general");

  useEffect(() => {
    if (!branchId) return;
    let active = true;
    void getDoc(doc(db, "branches", branchId)).then((snapshot) => {
      const branchTimeZone = snapshot.data()?.timezone;
      if (active && typeof branchTimeZone === "string" && branchTimeZone) {
        setTimeZone(branchTimeZone);
        if (!initialDate) setDate(dateInTimeZone(branchTimeZone));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [branchId, initialDate]);

  const loadRecords = useCallback(async (showLoading = true) => {
    if (!branchId || !date) {
      setRecords([]);
      if (showLoading) setLoading(false);
      return;
    }
    const sequence = ++requestSequence.current;
    if (showLoading) setLoading(true);
    setLoadError(null);
    try {
      const response = await attendanceService.getAttendanceList({ month: date.slice(0, 7) });
      if (sequence !== requestSequence.current) return;
      setRecords(response.attendance.filter((record) => record.date === date && record.branchId === branchId));
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setRecords([]);
      setLoadError(error instanceof Error ? error.message : "Unable to load attendance.");
    } finally {
      if (showLoading && sequence === requestSequence.current) setLoading(false);
    }
  }, [branchId, date]);

  useEffect(() => {
    setRecords([]);
    void loadRecords();
    return () => { requestSequence.current += 1; };
  }, [loadRecords]);

  const recordMap = useMemo(
    () => new Map(records.map((record) => [record.employeeId, record])),
    [records],
  );
  const selectedRecord = employeeId ? recordMap.get(employeeId) : undefined;

  useEffect(() => {
    if (!employeeId) {
      setStatus("");
      setNote("");
      return;
    }
    const existing = recordMap.get(employeeId);
    setStatus(detailsPurpose === "leave_reason" ? "on_leave" : existing?.status ?? "");
    setNote(
      detailsPurpose === "leave_reason" && existing?.status !== "on_leave"
        ? ""
        : existing?.note ?? ""
    );
  }, [detailsPurpose, employeeId, recordMap]);

  useEffect(() => {
    if (!editRequest) return;
    setDate(editRequest.date);
    setEmployeeId(editRequest.employeeId);
    setDetailsPurpose("general");
    setRosterView("marked");
    setMarkedFilter("all");
  }, [editRequest]);

  function openDetails(id: string) {
    if (employeeId === id) {
      setEmployeeId("");
      return;
    }
    setDetailsPurpose("general");
    setEmployeeId(id);
    const existing = recordMap.get(id);
    setStatus(existing?.status ?? "");
    setNote(existing?.note ?? "");
  }

  function requestLeaveReason(id: string) {
    setDetailsPurpose("leave_reason");
    setEmployeeId(id);
  }

  async function markStatus(id: string, nextStatus: AttendanceStatus) {
    if (!date || savingEmployeeId) return;
    const existing = recordMap.get(id);
    if (existing?.status === nextStatus) return;

    setSavingEmployeeId(id);
    try {
      await attendanceService.createAttendance({
        employeeId: id,
        date,
        status: nextStatus,
        note: existing?.note ?? "",
      });
      if (employeeId === id) setStatus(nextStatus);
      await loadRecords(false);
      const employee = employees.find((item) => item.id === id);
      setAnnouncement(
        `${employee ? employeeName(employee) : "Employee"} marked ${statusLabel(nextStatus).toLowerCase()} and moved to Marked.`
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save attendance.", "error");
    } finally {
      setSavingEmployeeId(null);
    }
  }

  async function saveAttendanceDetails(skipLeaveReason = false) {
    if (!employeeId || !status || !date || saving) {
      if (!saving) notify("Choose a status before saving the attendance details.", "error");
      return;
    }
    if (detailsPurpose === "leave_reason" && !skipLeaveReason && !note.trim()) {
      notify("Add a leave reason or choose Skip for now.", "error");
      return;
    }
    const updating = !!selectedRecord;
    setSaving(true);
    try {
      await attendanceService.createAttendance({
        employeeId,
        date,
        status,
        note: skipLeaveReason ? "" : note.trim(),
      });
      await loadRecords(false);
      const employee = employees.find((item) => item.id === employeeId);
      setAnnouncement(
        detailsPurpose === "leave_reason"
          ? `${employee ? employeeName(employee) : "Employee"} moved to Marked as on leave${skipLeaveReason ? " without a reason" : " with a reason"}.`
          : `${employee ? employeeName(employee) : "Employee"} attendance details updated.`
      );
      notify(updating ? "Attendance details updated." : "Attendance saved.", "success");
      setEmployeeId("");
      setDetailsPurpose("general");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save attendance.", "error");
    } finally {
      setSaving(false);
    }
  }

  const rosterRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const allRows = employees
      .map((employee) => {
        const record = recordMap.get(employee.id) ?? null;
        return { employee, record, displayStatus: (record?.status ?? "not_marked") as DisplayStatus };
      })
      .filter((row) => {
        return !query || employeeName(row.employee).toLowerCase().includes(query) || row.employee.email.toLowerCase().includes(query);
      })
      .sort((a, b) => employeeName(a.employee).localeCompare(employeeName(b.employee)));

    if (rosterView === "to_mark") {
      return allRows.filter((row) => row.displayStatus === "not_marked");
    }
    return allRows.filter(
      (row) => row.displayStatus !== "not_marked" && (markedFilter === "all" || row.displayStatus === markedFilter)
    );
  }, [employees, markedFilter, recordMap, rosterView, search]);

  const marked = records.length;
  const present = records.filter((record) => record.status === "present").length;
  const absent = records.filter((record) => record.status === "absent").length;
  const onLeave = records.filter((record) => record.status === "on_leave").length;
  const notMarked = Math.max(0, employees.length - marked);
  const today = dateInTimeZone(timeZone);
  const progress = employees.length ? Math.round((marked / employees.length) * 100) : 0;

  return (
    <section className="card overflow-hidden" aria-labelledby="attendance-heading">
      <div className="border-b border-line px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarCheck2 size={19} className="text-burgundy-600" />
              <h2 id="attendance-heading" className="text-lg font-semibold text-ink">
                {date === today ? "Today’s attendance" : `Attendance for ${formatSelectedDate(date)}`}
              </h2>
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              Select Present, Absent, or On leave beside each employee. Changes save immediately.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <label className="block">
              <span className="label-luxe">Attendance date</span>
              <input
                type="date"
                value={date}
                max={today}
                onChange={(event) => {
                  setDate(event.target.value);
                  setEmployeeId("");
                  setDetailsPurpose("general");
                  setRosterView("to_mark");
                  setMarkedFilter("all");
                  setAnnouncement("");
                }}
                className="input-luxe min-w-44"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadRecords()}
              disabled={loading}
              aria-label="Refresh attendance"
              className="btn-ghost mb-0.5 p-2.5"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SummaryCard label="Employees" value={employees.length} />
          <SummaryCard
            label="Marked"
            value={marked}
            tone="blue"
            active={rosterView === "marked" && markedFilter === "all"}
            onClick={() => { setRosterView("marked"); setMarkedFilter("all"); }}
          />
          <SummaryCard
            label="Present"
            value={present}
            tone="green"
            active={rosterView === "marked" && markedFilter === "present"}
            onClick={() => { setRosterView("marked"); setMarkedFilter("present"); }}
          />
          <SummaryCard
            label="Absent"
            value={absent}
            tone="rose"
            active={rosterView === "marked" && markedFilter === "absent"}
            onClick={() => { setRosterView("marked"); setMarkedFilter("absent"); }}
          />
          <SummaryCard
            label="On leave"
            value={onLeave}
            tone="amber"
            active={rosterView === "marked" && markedFilter === "on_leave"}
            onClick={() => { setRosterView("marked"); setMarkedFilter("on_leave"); }}
          />
          <SummaryCard
            label="Not marked"
            value={notMarked}
            active={rosterView === "to_mark"}
            onClick={() => setRosterView("to_mark")}
          />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink-soft">Daily completion</span>
            <span className="font-semibold text-burgundy-700">{marked}/{employees.length} marked · {progress}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-burgundy-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="border-b border-line bg-surface-muted/40 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-2 sm:grid-cols-2" role="tablist" aria-label="Attendance marking trays">
            <button
              type="button"
              role="tab"
              aria-selected={rosterView === "to_mark"}
              onClick={() => setRosterView("to_mark")}
              className={`flex min-w-52 items-center gap-3 rounded-xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-burgundy-300 ${
                rosterView === "to_mark"
                  ? "border-burgundy-300 bg-white shadow-sm ring-2 ring-burgundy-50"
                  : "border-line bg-white/70 hover:border-burgundy-200 hover:bg-white"
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-burgundy-50 text-burgundy-700">
                <CalendarCheck2 size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">To mark</span>
                <span className="block text-xs text-ink-faint">Employees still waiting</span>
              </span>
              <span className="rounded-full bg-burgundy-600 px-2.5 py-1 text-xs font-bold text-white">{notMarked}</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={rosterView === "marked"}
              onClick={() => { setRosterView("marked"); setMarkedFilter("all"); }}
              className={`flex min-w-52 items-center gap-3 rounded-xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                rosterView === "marked"
                  ? "border-sky-300 bg-white shadow-sm ring-2 ring-sky-50"
                  : "border-line bg-white/70 hover:border-sky-200 hover:bg-white"
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                <Inbox size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">Marked</span>
                <span className="block text-xs text-ink-faint">Review or edit saved entries</span>
              </span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={marked}
                  initial={{ scale: 0.65, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 1.25, opacity: 0 }}
                  className="rounded-full bg-sky-600 px-2.5 py-1 text-xs font-bold text-white"
                >
                  {marked}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>

          <label className="relative block lg:w-72">
            <span className="sr-only">Search employees</span>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${rosterView === "to_mark" ? "employees to mark" : "marked employees"}`}
              className="w-full rounded-xl border border-line bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-burgundy-400 focus:ring-2 focus:ring-burgundy-100"
            />
          </label>
        </div>

        {rosterView === "marked" && (
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter marked attendance">
            <span className="mr-1 text-xs font-medium text-ink-faint">Show:</span>
            {(["all", "present", "absent", "on_leave"] as MarkedFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={markedFilter === value}
                onClick={() => setMarkedFilter(value)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  markedFilter === value
                    ? "bg-sky-600 text-white"
                    : "border border-line bg-white text-ink-soft hover:border-sky-200 hover:text-ink"
                }`}
              >
                {value === "all" ? `All marked (${marked})` : `${statusLabel(value)} (${value === "present" ? present : value === "absent" ? absent : onLeave})`}
              </button>
            ))}
          </div>
        )}

        {announcement && (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700" aria-live="polite">
            <CheckCircle2 size={13} /> {announcement}
          </p>
        )}
      </div>

      {loading ? (
        <CenterSpinner label="Loading attendance" />
      ) : loadError ? (
        <div className="p-5 text-center">
          <p className="text-sm text-rose-600">{loadError}</p>
          <button type="button" onClick={() => void loadRecords()} className="btn-ghost mt-3">Retry</button>
        </div>
      ) : employees.length === 0 ? (
        <EmptyState title="No active employees were found for this branch." />
      ) : rosterRows.length === 0 ? (
        rosterView === "to_mark" && notMarked === 0 && !search ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="px-5 py-12 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 size={24} />
            </span>
            <h3 className="mt-3 text-base font-semibold text-ink">Everyone is marked</h3>
            <p className="mt-1 text-sm text-ink-soft">Today’s attendance is complete. Open Marked to review or make changes.</p>
            <button
              type="button"
              onClick={() => { setRosterView("marked"); setMarkedFilter("all"); }}
              className="btn-primary mt-4 inline-flex items-center gap-2"
            >
              <Inbox size={15} /> Open marked employees
            </button>
          </motion.div>
        ) : (
          <EmptyState
            title={rosterView === "to_mark" ? "No unmarked employees match your search." : "No marked employees match this view."}
            hint={rosterView === "to_mark" ? "Clear the search to continue marking attendance." : "Clear the search or choose another saved status."}
          />
        )
      ) : (
        <motion.div layout className="divide-y divide-line">
          <AnimatePresence initial={false} mode="popLayout">
          {rosterRows.map(({ employee, record, displayStatus }) => {
            const name = employeeName(employee);
            const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
            const rowSaving = savingEmployeeId === employee.id;
            const detailsOpen = employeeId === employee.id;

            return (
              <motion.div
                layout
                key={employee.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 52, scale: 0.98 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className={detailsOpen ? "bg-burgundy-50/20" : "bg-white"}
              >
                <div className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-burgundy-50 text-xs font-bold text-burgundy-700">
                      {initials || "?"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{name}</p>
                      <p className="truncate text-xs text-ink-faint">{employee.email} · {employee.role}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 xl:w-56">
                    <div>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGES[displayStatus]}`}>
                        {statusLabel(displayStatus)}
                      </span>
                      <p className="mt-1 text-[10px] text-ink-faint">
                        {record ? `Updated ${formatTimestamp(record.updatedAt ?? record.createdAt)}` : "No record yet"}
                      </p>
                      {record?.status === "on_leave" && (
                        <p
                          className={`mt-1 max-w-52 truncate text-[11px] font-medium ${
                            record.note?.trim() ? "text-ink-soft" : "text-amber-700"
                          }`}
                          title={record.note?.trim() || "Reason not given"}
                        >
                          {record.note?.trim() ? `Reason: ${record.note}` : "Reason not given"}
                        </p>
                      )}
                    </div>
                    {rowSaving && <LoaderCircle size={17} className="animate-spin text-burgundy-600" />}
                  </div>

                  <div className="grid grid-cols-3 gap-2 xl:w-[390px]" role="group" aria-label={`Mark attendance for ${name}`}>
                    {STATUS_OPTIONS.map((option) => {
                      const Icon = option.icon;
                      const selected = displayStatus === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            if (option.value === "on_leave") requestLeaveReason(employee.id);
                            else void markStatus(employee.id, option.value);
                          }}
                          disabled={rowSaving || savingEmployeeId !== null || selected}
                          aria-pressed={selected}
                          className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-burgundy-400 disabled:cursor-default ${
                            selected
                              ? option.selected
                              : `border-line bg-white text-ink-soft ${option.hover} disabled:opacity-60`
                          }`}
                        >
                          <Icon size={14} /> {option.label}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (record?.status === "on_leave" && !record.note?.trim()) requestLeaveReason(employee.id);
                      else openDetails(employee.id);
                    }}
                    className={`btn-ghost inline-flex min-h-10 items-center justify-center gap-2 xl:shrink-0 ${detailsOpen ? "border-burgundy-200 bg-burgundy-50 text-burgundy-700" : ""}`}
                    aria-expanded={detailsOpen}
                  >
                    <MessageSquareText size={14} />{
                      record?.status === "on_leave"
                        ? record.note?.trim() ? "Edit reason" : "Add reason"
                        : record?.note ? "Edit note" : "Add note"
                    }
                  </button>
                </div>

                {detailsOpen && (
                  <div className="border-t border-burgundy-100 bg-burgundy-50/35 px-5 py-4">
                    <div className="ml-auto max-w-3xl">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-ink">
                            {detailsPurpose === "leave_reason" ? `Why is ${name} on leave?` : `Attendance details for ${name}`}
                          </p>
                          <p className="text-xs text-ink-faint">
                            {detailsPurpose === "leave_reason"
                              ? "A short reason makes the attendance history easier to understand. You may skip it for now."
                              : "Change the status if needed and add an optional note."}
                          </p>
                        </div>
                        {selectedRecord && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                            <CheckCircle2 size={13} /> Saved record
                          </span>
                        )}
                      </div>

                      {detailsPurpose === "general" && <div className="mt-3 flex flex-wrap gap-2">
                        {STATUS_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const selected = status === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setStatus(option.value)}
                              aria-pressed={selected}
                              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                                selected ? option.selected : `border-line bg-white text-ink-soft ${option.hover}`
                              }`}
                            >
                              <Icon size={14} /> {option.label}
                            </button>
                          );
                        })}
                      </div>}

                      <label className="mt-3 block">
                        <span className="text-xs font-semibold text-ink">
                          {detailsPurpose === "leave_reason" || status === "on_leave" ? "Leave reason" : "Note"}
                          <span className="ml-1 font-normal text-ink-faint">(optional)</span>
                        </span>
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={2}
                        autoFocus={detailsPurpose === "leave_reason"}
                        placeholder={detailsPurpose === "leave_reason" || status === "on_leave"
                          ? "For example: approved annual leave, medical leave, or family emergency"
                          : "Add an optional attendance note"}
                        className="mt-1.5 w-full resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-burgundy-400 focus:ring-2 focus:ring-burgundy-100"
                      />
                      </label>

                      {detailsPurpose === "leave_reason" && !note.trim() && (
                        <p className="mt-2 text-xs text-amber-700">
                          If skipped, this employee will show “Reason not given” in Marked until it is added later.
                        </p>
                      )}

                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setEmployeeId(""); setDetailsPurpose("general"); }}
                          className="btn-ghost"
                        >
                          Cancel
                        </button>
                        {detailsPurpose === "leave_reason" && (
                          <button
                            type="button"
                            onClick={() => void saveAttendanceDetails(true)}
                            disabled={saving}
                            className="btn-ghost"
                          >
                            Skip for now
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void saveAttendanceDetails()}
                          disabled={saving || !status || (detailsPurpose === "leave_reason" && !note.trim())}
                          className="btn-primary inline-flex items-center gap-2"
                        >
                          <Save size={15} /> {
                            saving
                              ? "Saving…"
                              : detailsPurpose === "leave_reason"
                                ? "Save on leave"
                                : "Save details"
                          }
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
          </AnimatePresence>
        </motion.div>
      )}

      {!loading && !loadError && employees.length > 0 && rosterView === "to_mark" && notMarked > 0 && (
        <p className="border-t border-line bg-amber-50 px-5 py-3 text-sm text-amber-800">
          {notMarked} employee{notMarked === 1 ? "" : "s"} still need attendance. Choose a status directly on their row.
        </p>
      )}
    </section>
  );
}
