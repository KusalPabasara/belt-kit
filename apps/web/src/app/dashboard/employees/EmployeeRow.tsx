"use client";

import React from "react";
import { Employee } from "@/lib/models";
import { formatMoney, formatDate, initials } from "@/lib/format";
import { Badge } from "@/components/ui";
import { Pencil, Wallet, Clock, Archive, ToggleLeft, ToggleRight } from "lucide-react";

export default function EmployeeRow({
  employee,
  onEdit,
  onArchive,
  onToggleStatus,
  onRecordPayment,
  onViewHistory,
}: {
  employee: Employee;
  onEdit?: (e: Employee) => void;
  onArchive?: (e: Employee) => void;
  onToggleStatus?: (e: Employee) => void;
  onRecordPayment?: (e: Employee) => void;
  onViewHistory?: (e: Employee) => void;
}) {
  const name = employee.fullName ?? employee.displayName ?? "Unnamed";
  const salary = formatMoney(employee.salaryMinor ?? 0);

  let join: Date | undefined;
  if (!employee.joinDate) join = undefined;
  else if (typeof employee.joinDate === "string") join = new Date(employee.joinDate);
  else if ((employee.joinDate as any).toDate) join = (employee.joinDate as any).toDate();
  else join = employee.joinDate as unknown as Date;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rosegold-sheen text-sm font-semibold text-white">
          {initials(name)}
        </div>
        <div>
          <p className="font-medium text-ink">{name}</p>
          <p className="text-xs text-ink-faint">{employee.email}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 sm:mt-0">
        <div className="min-w-[110px]">
          <Badge>{employee.role}</Badge>
        </div>
        <div className="min-w-[120px] text-sm text-ink-soft">{employee.phone ?? "—"}</div>
        <div className="min-w-[120px] text-sm text-ink">{salary}</div>
        <div className="min-w-[140px] text-sm text-ink-soft">{formatDate(join)}</div>
        <div className="min-w-[80px]">
          <Badge tone={employee.active ? "green" : "amber"}>{employee.active ? "Active" : "Inactive"}</Badge>
        </div>

        <div className="ml-2 flex gap-2">
          <button
            onClick={() => onEdit && onEdit(employee)}
            className="rounded-lg border border-line p-2 text-ink-soft transition hover:border-burgundy-300 hover:text-burgundy-600"
            aria-label="Edit"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={() => onToggleStatus && onToggleStatus(employee)}
            className="rounded-lg border border-line p-2 text-ink-soft transition hover:border-burgundy-300 hover:text-burgundy-600"
            aria-label={employee.active ? "Deactivate" : "Activate"}
          >
            {employee.active ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
          </button>
          <button
            onClick={() => onArchive && onArchive(employee)}
            className="rounded-lg border border-line p-2 text-ink-soft transition hover:border-burgundy-300 hover:text-burgundy-600"
            aria-label="Archive"
          >
            <Archive size={16} />
          </button>
          <button
            onClick={() => onRecordPayment && onRecordPayment(employee)}
            className="rounded-lg border border-line p-2 text-ink-soft transition hover:border-burgundy-300 hover:text-burgundy-600"
            aria-label="Record payment"
          >
            <Wallet size={16} />
          </button>
          <button
            onClick={() => onViewHistory && onViewHistory(employee)}
            className="rounded-lg border border-line p-2 text-ink-soft transition hover:border-burgundy-300 hover:text-burgundy-600"
            aria-label="View history"
          >
            <Clock size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
