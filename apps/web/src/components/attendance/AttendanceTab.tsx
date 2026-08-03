"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Download, FileText, Search } from "lucide-react";
import { CenterSpinner, EmptyState, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import useEmployees from "@/lib/hooks/useEmployees";
import { useCollection, where } from "@/lib/useCollection";
import attendanceService from "@/lib/services/attendanceService";
import { downloadAttendanceReport } from "@/lib/services/attendanceReportService";
import type { Attendance, AttendanceStatus } from "@/lib/types/attendance";
import type { Employee } from "@/lib/models";
import { AttendanceRecords } from "./AttendanceRecords";
import { EmployeeSelector } from "./EmployeeSelector";
import { MarkAttendance } from "./MarkAttendance";
import { SummaryCard } from "./SummaryCard";

type View = "mark" | "reports" | "records";
type ReportMode = "month" | "person";
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function nameOf(employee: Employee) {
  return employee.fullName ?? employee.displayName ?? employee.email;
}

export function AttendanceTab({ initialDate, initialEmployeeId }: { initialDate?: string; initialEmployeeId?: string }) {
  const { role, roleResolved, branchId } = useAuth();
  const { employees, loading: employeeLoading, error: employeeError } = useEmployees({ branchScoped: true });
  const { data: allUsers, loading: allUsersLoading, error: allUsersError } = useCollection<Employee>(
    "users",
    [where("branchId", "==", branchId ?? "__missing_branch__")],
    true,
  );
  const { notify } = useToast();
  const sequence = useRef(0);
  const [view, setView] = useState<View>("mark");
  const [month, setMonth] = useState(() => initialDate?.slice(0, 7) || currentMonth());
  const [reportMode, setReportMode] = useState<ReportMode>("month");
  const [reportEmployeeId, setReportEmployeeId] = useState(initialEmployeeId ?? "");
  const [recordsEmployeeId, setRecordsEmployeeId] = useState("");
  const [status, setStatus] = useState<AttendanceStatus | "">("");
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<Attendance[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingEmployeeIds, setDownloadingEmployeeIds] = useState<Set<string>>(() => new Set());
  const [editRequest, setEditRequest] = useState<{ employeeId: string; date: string; nonce: number } | null>(null);

  const reportOnly = role === "advisor" || (role as string | null) === "admin";
  const canManage = role === "owner" || role === "manager";
  const canDownload = canManage || reportOnly;
  const sourceEmployees = reportOnly ? allUsers : employees;
  const employeesLoading = reportOnly ? allUsersLoading : employeeLoading;
  const employeesError = reportOnly ? allUsersError : employeeError;

  const visibleEmployees = useMemo(() => sourceEmployees
    .filter((employee) => employee.branchId === branchId)
    .filter((employee) => employee.active !== false && employee.archived !== true)
    .filter((employee) => employee.role !== "customer" && employee.role !== "pending")
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b))), [branchId, sourceEmployees]);

  const loadRecords = useCallback(async () => {
    if (!canManage || !branchId || !MONTH_PATTERN.test(month)) {
      setRecords([]);
      setLoadingRecords(false);
      return;
    }
    const request = ++sequence.current;
    setLoadingRecords(true);
    setRecordsError(null);
    try {
      const response = await attendanceService.getAttendanceList({ month });
      if (request !== sequence.current) return;
      setRecords(response.attendance.filter((record) => record.branchId === branchId && record.date.startsWith(month)));
    } catch (error) {
      if (request !== sequence.current) return;
      setRecords([]);
      setRecordsError(error instanceof Error ? error.message : "Unable to load attendance records.");
    } finally {
      if (request === sequence.current) setLoadingRecords(false);
    }
  }, [branchId, canManage, month]);

  useEffect(() => {
    setRecords([]);
    if (view === "reports" || view === "records") void loadRecords();
    return () => { sequence.current += 1; };
  }, [loadRecords, view]);

  const filteredRecords = useMemo(() => records
    .filter((record) => !recordsEmployeeId || record.employeeId === recordsEmployeeId)
    .filter((record) => !status || record.status === status)
    .filter((record) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      const employee = visibleEmployees.find((item) => item.id === record.employeeId);
      return !!employee && (nameOf(employee).toLowerCase().includes(query) || employee.email.toLowerCase().includes(query));
    })
    .sort((a, b) => b.date.localeCompare(a.date)), [records, recordsEmployeeId, search, status, visibleEmployees]);

  const reportRecords = reportMode === "person" && reportEmployeeId
    ? records.filter((record) => record.employeeId === reportEmployeeId)
    : records;

  async function downloadReport(request: { reportType: "month"; month: string } | { reportType: "person"; month: string; employeeId: string }) {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadAttendanceReport(request);
      notify("Attendance report downloaded.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not download attendance report.", "error");
    } finally {
      setDownloading(false);
    }
  }

  async function downloadRecord(record: Attendance) {
    if (downloadingEmployeeIds.has(record.employeeId)) return;
    setDownloadingEmployeeIds((current) => new Set(current).add(record.employeeId));
    try {
      await downloadAttendanceReport({ reportType: "person", month: record.date.slice(0, 7), employeeId: record.employeeId });
      notify("Attendance report downloaded.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not download attendance report.", "error");
    } finally {
      setDownloadingEmployeeIds((current) => { const next = new Set(current); next.delete(record.employeeId); return next; });
    }
  }

  function editRecord(record: Attendance) {
    setEditRequest({ employeeId: record.employeeId, date: record.date, nonce: Date.now() });
    setView("mark");
  }

  if (!roleResolved || employeesLoading) return <CenterSpinner label="Loading attendance workspace" />;
  if (employeesError) return <EmptyState title="Could not load employees" hint={employeesError} />;
  if (!canManage && !reportOnly) return <EmptyState title="Not authorized" hint="Attendance management is available to owners and managers." />;

  if (reportOnly) {
    return <ReportToolbar employees={visibleEmployees} month={month} setMonth={setMonth} mode={reportMode} setMode={setReportMode} employeeId={reportEmployeeId} setEmployeeId={setReportEmployeeId} downloading={downloading} onDownload={downloadReport} />;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3" role="tablist" aria-label="Attendance sections">
        {([{"id":"mark","label":"Mark Attendance"},{"id":"reports","label":"Summary & Reports","icon":FileText},{"id":"records","label":"Attendance Records","icon":ClipboardList}] as const).map((tab) => {
          const Icon = "icon" in tab ? tab.icon : null;
          return <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} onClick={() => setView(tab.id)} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-burgundy-500 ${view === tab.id ? "border-burgundy-500 bg-burgundy-50 text-burgundy-700" : "border-line bg-white text-ink-soft hover:bg-surface-muted"}`}>{Icon && <Icon size={16} />}{tab.label}</button>;
        })}
      </div>

      {view === "mark" && <MarkAttendance employees={visibleEmployees} initialDate={initialDate} initialEmployeeId={initialEmployeeId} editRequest={editRequest} />}

      {view === "reports" && (
        <div className="space-y-4">
          <ReportToolbar employees={visibleEmployees} month={month} setMonth={setMonth} mode={reportMode} setMode={setReportMode} employeeId={reportEmployeeId} setEmployeeId={setReportEmployeeId} downloading={downloading} onDownload={downloadReport} />
          {!loadingRecords && !recordsError && <div className="grid grid-cols-2 gap-3 md:grid-cols-5"><SummaryCard label="Marked entries" value={reportRecords.length} tone="blue" /><SummaryCard label="Present" value={reportRecords.filter((record) => record.status === "present").length} tone="green" /><SummaryCard label="Absent" value={reportRecords.filter((record) => record.status === "absent").length} tone="rose" /><SummaryCard label="On leave" value={reportRecords.filter((record) => record.status === "on_leave").length} tone="amber" /><SummaryCard label="Employees" value={reportMode === "person" ? (reportEmployeeId ? 1 : 0) : new Set(reportRecords.map((record) => record.employeeId)).size} /></div>}
        </div>
      )}

      {view === "records" && (
        <div className="space-y-4">
          <div className="card grid gap-3 p-4 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-ink">Month</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 outline-none focus:border-burgundy-400" /></label>
            <EmployeeSelector label="Employee" value={recordsEmployeeId} options={visibleEmployees.map((employee) => ({ id: employee.id, label: nameOf(employee) }))} onChange={setRecordsEmployeeId} />
            <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-ink">Status</span><select value={status} onChange={(event) => setStatus(event.target.value as AttendanceStatus | "")} className="rounded-xl border border-line bg-white px-3 py-2 outline-none focus:border-burgundy-400"><option value="">All statuses</option><option value="present">Present</option><option value="absent">Absent</option><option value="on_leave">On leave</option></select></label>
            <label className="relative flex flex-col gap-1 text-sm"><span className="font-medium text-ink">Search</span><Search size={15} className="absolute bottom-3 left-3 text-ink-faint" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Employee name" className="rounded-xl border border-line bg-white py-2 pl-9 pr-3 outline-none focus:border-burgundy-400" /></label>
          </div>
          <AttendanceRecords records={filteredRecords} employees={visibleEmployees} loading={loadingRecords} error={recordsError} downloadingEmployeeIds={downloadingEmployeeIds} onEdit={editRecord} onDownload={(record) => void downloadRecord(record)} />
        </div>
      )}
    </div>
  );
}

type ReportProps = { employees: Employee[]; month: string; setMonth: (value: string) => void; mode: ReportMode; setMode: (value: ReportMode) => void; employeeId: string; setEmployeeId: (value: string) => void; downloading: boolean; onDownload: (request: { reportType: "month"; month: string } | { reportType: "person"; month: string; employeeId: string }) => Promise<void> };

function ReportToolbar({ employees, month, setMonth, mode, setMode, employeeId, setEmployeeId, downloading, onDownload }: ReportProps) {
  const valid = MONTH_PATTERN.test(month) && (mode === "month" || !!employeeId);
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2"><FileText size={18} className="text-burgundy-600" /><h2 className="text-lg font-semibold text-ink">Attendance reports</h2></div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-ink">Report type</span><select value={mode} onChange={(event) => setMode(event.target.value as ReportMode)} className="rounded-xl border border-line bg-white px-3 py-2 outline-none focus:border-burgundy-400"><option value="month">Monthly report</option><option value="person">Employee report</option></select></label>
        <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-ink">Month</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 outline-none focus:border-burgundy-400" /></label>
        {mode === "person" && <EmployeeSelector label="Employee" value={employeeId} options={employees.map((employee) => ({ id: employee.id, label: `${nameOf(employee)} — ${employee.email}` }))} onChange={setEmployeeId} />}
      </div>
      <p className="mt-3 text-sm text-ink-soft">{mode === "month" ? "Download a summary and detailed attendance report for all employees." : "Download the selected employee’s day-by-day attendance report."}</p>
      <button type="button" disabled={!valid || downloading} onClick={() => void onDownload(mode === "month" ? { reportType: "month", month } : { reportType: "person", month, employeeId })} className="btn-primary mt-4 inline-flex w-full items-center justify-center gap-2 sm:w-auto" aria-label={mode === "month" ? `Download monthly attendance PDF for ${month}` : `Download employee attendance PDF for ${month}`}><Download size={16} />{downloading ? "Preparing PDF..." : mode === "month" ? "Download monthly PDF" : "Download employee PDF"}</button>
    </div>
  );
}
