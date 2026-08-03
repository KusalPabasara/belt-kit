"use client";

import { Download, Pencil } from "lucide-react";
import { EmptyState } from "@/components/ui";
import type { Attendance, SerializedTimestamp } from "@/lib/types/attendance";
import type { Employee } from "@/lib/models";

type Props = {
  records: Attendance[];
  employees: Employee[];
  loading?: boolean;
  error?: string | null;
  downloadingEmployeeIds?: Set<string>;
  onEdit: (record: Attendance) => void;
  onDownload: (record: Attendance) => void;
};

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(year, month - 1, day))
    : value || "—";
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

export function AttendanceRecords({ records, employees, loading, error, downloadingEmployeeIds, onEdit, onDownload }: Props) {
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

  if (loading) return <div className="card p-8 text-center text-sm text-ink-soft">Loading records…</div>;
  if (error) return <EmptyState title="Could not load records" hint={error} />;
  if (records.length === 0) return <EmptyState title="No attendance records" hint="Try a different employee, month, status, or search." />;

  return (
    <div className="card overflow-hidden">
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-surface-muted/70 text-[11px] uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Employee</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Note</th>
              <th className="px-5 py-3">Updated</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {records.map((record) => {
              const employee = employeeMap.get(record.employeeId);
              const name = employee?.fullName ?? employee?.displayName ?? employee?.email ?? "Unknown employee";
              return (
                <tr key={record.id} className="align-top">
                  <td className="whitespace-nowrap px-5 py-4 text-ink-soft">{formatDate(record.date)}</td>
                  <td className="px-5 py-4"><p className="font-medium text-ink">{name}</p><p className="text-xs text-ink-faint">{employee?.email}</p></td>
                  <td className="px-5 py-4"><Status status={record.status} /></td>
                  <td className="max-w-xs px-5 py-4 text-ink-soft">{record.note || "—"}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-xs text-ink-faint">{formatTimestamp(record.updatedAt ?? record.createdAt)}</td>
                  <td className="px-5 py-4"><Actions record={record} name={name} downloading={downloadingEmployeeIds?.has(record.employeeId)} onEdit={onEdit} onDownload={onDownload} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-line md:hidden">
        {records.map((record) => {
          const employee = employeeMap.get(record.employeeId);
          const name = employee?.fullName ?? employee?.displayName ?? employee?.email ?? "Unknown employee";
          return (
            <article key={record.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-ink">{name}</p><p className="text-xs text-ink-faint">{formatDate(record.date)}</p></div><Status status={record.status} /></div>
              {record.note && <p className="text-sm text-ink-soft">{record.note}</p>}
              <p className="text-xs text-ink-faint">Updated {formatTimestamp(record.updatedAt ?? record.createdAt)}</p>
              <Actions record={record} name={name} downloading={downloadingEmployeeIds?.has(record.employeeId)} onEdit={onEdit} onDownload={onDownload} />
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Status({ status }: { status: Attendance["status"] }) {
  const style = status === "present"
    ? "bg-emerald-50 text-emerald-700"
    : status === "absent"
      ? "bg-rose-50 text-rose-700"
      : "bg-amber-50 text-amber-700";
  const label = status === "present" ? "Present" : status === "absent" ? "Absent" : "On leave";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{label}</span>;
}

function Actions({ record, name, downloading, onEdit, onDownload }: { record: Attendance; name: string; downloading?: boolean; onEdit: (record: Attendance) => void; onDownload: (record: Attendance) => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={() => onEdit(record)} className="btn-ghost inline-flex min-h-9 items-center gap-1.5 text-xs" aria-label={`Edit attendance for ${name}`}><Pencil size={13} /> Edit</button>
      <button type="button" onClick={() => onDownload(record)} disabled={downloading} className="btn-ghost inline-flex min-h-9 items-center gap-1.5 text-xs" aria-label={`Download attendance PDF for ${name} in ${record.date.slice(0, 7)}`}><Download size={13} /> {downloading ? "Preparing..." : "PDF"}</button>
    </div>
  );
}
