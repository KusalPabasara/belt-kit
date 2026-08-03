"use client";

import { PageHeader, EmptyState, TableSkeleton, useToast } from "@/components/ui";
import { Users, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Employee } from "@/lib/models";
import useEmployees from "@/lib/hooks/useEmployees";
import employeeService from "@/lib/services/employeeService";
import EmployeeRow from "./EmployeeRow";
import EmployeeForm from "./EmployeeForm";
import EmployeePaymentModal from "./EmployeePaymentModal";
import PaymentHistory from "./PaymentHistory";
import EmployeeActionModal from "./EmployeeActionModal";
import EmployeePaymentHistoryModal from "./EmployeePaymentHistoryModal";

export default function EmployeesPage() {
  const { role } = useAuth();
  const { employees, loading, error, refresh } = useEmployees();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [paymentHistoryOpen, setPaymentHistoryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [actionKind, setActionKind] = useState<"archive" | "status" | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const { notify } = useToast();

  const unauthorized = !(role === "owner" || role === "manager");

  const filteredEmployees = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return employees;

    return employees.filter((employee) => {
      const haystacks = [
        employee.fullName,
        employee.displayName,
        employee.email,
        employee.phone,
        employee.role,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      return haystacks.some((value) => value.includes(query));
    });
  }, [employees, searchQuery]);

  async function runEmployeeAction(nextAction: "archive" | "status", employee: Employee) {
    setSelectedEmployee(employee);
    setActionKind(nextAction);
    setActionOpen(true);
  }

  async function confirmAction() {
    const employee = selectedEmployee;
    if (!employee) return;

    setBusyAction(true);
    try {
      if (actionKind === "archive") {
        await employeeService.updateEmployee({
          employeeId: employee.id,
          updates: { archived: true },
        });
        notify("Employee archived", "success");
      } else {
        await employeeService.updateEmployee({
          employeeId: employee.id,
          updates: { active: !employee.active },
        });
        notify(employee.active ? "Employee deactivated" : "Employee activated", "success");
      }
      setActionOpen(false);
      setSelectedEmployee(null);
      setActionKind(null);
      refresh();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "Could not update employee.";
      notify(msg, "error");
    } finally {
      setBusyAction(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Administration" title="Employees" icon={Users} />

      {unauthorized ? (
        <EmptyState title="Not authorized" hint="Only owners and managers can view employees." />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex w-full items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink-soft sm:max-w-sm">
              <Search size={16} className="text-ink-faint" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by name, email, phone or role"
                className="w-full border-none bg-transparent outline-none"
              />
            </label>

            <div className="flex gap-2">
              <button onClick={() => setPaymentHistoryOpen(true)} className="btn-ghost">
                Payment History
              </button>
              <button onClick={() => setCreateOpen(true)} className="btn-primary">
                Create Employee
              </button>
            </div>
          </div>

          {loading ? (
            <TableSkeleton />
          ) : error ? (
            <EmptyState title="Could not load employees" hint={error} />
          ) : employees.length === 0 ? (
            <EmptyState title="No employees" hint="No employees found for your branch." />
          ) : filteredEmployees.length === 0 ? (
            <EmptyState title="No matches" hint="Try a different search term." />
          ) : (
            <div className="space-y-3">
              {filteredEmployees.map((e) => (
                <EmployeeRow
                  key={e.id}
                  employee={e}
                  onEdit={(emp) => {
                    setEditingEmployee(emp);
                    setEditOpen(true);
                  }}
                  onArchive={(emp) => runEmployeeAction("archive", emp)}
                  onToggleStatus={(emp) => runEmployeeAction("status", emp)}
                  onRecordPayment={(emp) => {
                    setSelectedEmployee(emp);
                    setPaymentOpen(true);
                  }}
                  onViewHistory={(emp) => {
                    setSelectedEmployee(emp);
                    setHistoryOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      <EmployeeForm
        mode="create"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onSuccess={() => {
          setCreateOpen(false);
          refresh();
        }}
      />

      {/* Edit modal */}
      <EmployeeForm
        mode="edit"
        employee={editingEmployee}
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          setEditingEmployee(null);
        }}
        onSuccess={() => {
          setEditOpen(false);
          setEditingEmployee(null);
          refresh();
        }}
      />

      <EmployeeActionModal
        open={actionOpen}
        title={actionKind === "archive" ? "Archive employee" : selectedEmployee?.active ? "Deactivate employee" : "Activate employee"}
        message={
          actionKind === "archive"
            ? "This will mark the employee as archived."
            : `This will ${selectedEmployee?.active ? "deactivate" : "activate"} the employee.`
        }
        confirmLabel={actionKind === "archive" ? "Archive" : selectedEmployee?.active ? "Deactivate" : "Activate"}
        busy={busyAction}
        danger={actionKind === "archive"}
        onClose={() => {
          setActionOpen(false);
          setSelectedEmployee(null);
          setActionKind(null);
        }}
        onConfirm={confirmAction}
      />

      <EmployeePaymentModal
        open={paymentOpen}
        employee={selectedEmployee}
        onClose={() => {
          setPaymentOpen(false);
          setSelectedEmployee(null);
        }}
        onSuccess={() => {
          setPaymentOpen(false);
          setSelectedEmployee(null);
          refresh();
        }}
      />

      <PaymentHistory
        open={historyOpen}
        employee={selectedEmployee}
        onClose={() => {
          setHistoryOpen(false);
          setSelectedEmployee(null);
        }}
      />

      <EmployeePaymentHistoryModal
        open={paymentHistoryOpen}
        employees={employees}
        onClose={() => setPaymentHistoryOpen(false)}
      />
    </div>
  );
}
