"use client";

import { useEffect, useState } from "react";
import { Modal, Field, useToast } from "@/components/ui";
import { Employee } from "@/lib/models";
import { Role } from "@/lib/auth-context";
import employeeService from "@/lib/services/employeeService";
import { toMinor } from "@/lib/format";

type Props = {
  mode: "create" | "edit";
  employee?: Employee | null;
  open: boolean;
  onSuccess: () => void;
  onCancel: () => void;
};

function employeeJoinDate(employee?: Employee | null): string {
  if (!employee?.joinDate) return "";
  if (typeof employee.joinDate === "string") return employee.joinDate.slice(0, 10);

  try {
    const date = employee.joinDate.toDate();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch {
    return "";
  }
}

export default function EmployeeForm({ mode, employee, open, onSuccess, onCancel }: Props) {
  const { notify } = useToast();
  const [fullName, setFullName] = useState(employee?.fullName ?? employee?.displayName ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>((employee?.role as Role) ?? ("technician" as Role));
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [salary, setSalary] = useState<string>(employee?.salaryMinor ? String((employee.salaryMinor ?? 0) / 100) : "0.00");
  const [joinDate, setJoinDate] = useState<string>(() => employeeJoinDate(employee));
  const [active, setActive] = useState<boolean>(employee?.active ?? true);
  const [archived, setArchived] = useState<boolean>(employee?.archived ?? false);

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;

    setFullName(employee?.fullName ?? employee?.displayName ?? "");
    setEmail(employee?.email ?? "");
    setPassword("");
    setRole((employee?.role as Role) ?? "technician");
    setPhone(employee?.phone ?? "");
    setSalary(
      employee?.salaryMinor !== undefined
        ? (employee.salaryMinor / 100).toFixed(2)
        : "0.00"
    );
    setJoinDate(employeeJoinDate(employee));
    setActive(employee?.active ?? true);
    setArchived(employee?.archived ?? false);
    setErrors({});
  }, [employee, open]);

  function validate() {
    const e: Record<string, string> = {};
    if (!fullName.trim()) e.fullName = "Full name is required.";
    if (mode === "create") {
      if (!email.trim()) e.email = "Email is required.";
      if (!password || password.length < 6) e.password = "Password must be at least 6 characters.";
    }
    if (!role) e.role = "Role is required.";
    if (!salary || isNaN(Number(salary))) e.salary = "Salary is required and must be a number.";
    if (!joinDate) e.joinDate = "Join date is required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      if (mode === "create") {
        const payload = {
          fullName: fullName.trim(),
          email: email.trim(),
          password,
          role,
          phone: phone.trim() || null,
          salaryMinor: toMinor(salary),
          joinDate: joinDate || null,
        };
        await employeeService.createEmployee(payload as any);
        notify("Employee created", "success");
        onSuccess();
      } else {
        const updates: any = {
          fullName: fullName.trim(),
          role,
          phone: phone.trim() || null,
          salaryMinor: toMinor(salary),
          joinDate: joinDate || null,
          active,
          archived,
        };
        await employeeService.updateEmployee({ employeeId: employee!.id, updates });
        notify("Employee updated", "success");
        onSuccess();
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      const msg = (err as { message?: string })?.message ?? "Could not complete request.";
      notify(code.includes("permission-denied") ? "You don't have permission." : msg, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onCancel} title={mode === "create" ? "Create employee" : "Edit employee"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Full name" required>
          <input value={fullName} onChange={(ev) => setFullName(ev.target.value)} className="input-luxe" />
          {errors.fullName && <p className="mt-1 text-sm text-rose-600">{errors.fullName}</p>}
        </Field>

        {mode === "create" && (
          <Field label="Email (login)" required>
            <input value={email} onChange={(ev) => setEmail(ev.target.value)} className="input-luxe" />
            {errors.email && <p className="mt-1 text-sm text-rose-600">{errors.email}</p>}
          </Field>
        )}

        {mode === "create" && (
          <Field label="Password" required hint="Temporary password for the new employee.">
            <input value={password} onChange={(ev) => setPassword(ev.target.value)} className="input-luxe" />
            {errors.password && <p className="mt-1 text-sm text-rose-600">{errors.password}</p>}
          </Field>
        )}

        <Field label="Role" required>
          <select value={role} onChange={(ev) => setRole(ev.target.value as Role)} className="input-luxe">
            <option value="manager">Manager</option>
            <option value="advisor">Advisor</option>
            <option value="technician">Technician</option>
            <option value="accountant">Accountant</option>
          </select>
          {errors.role && <p className="mt-1 text-sm text-rose-600">{errors.role}</p>}
        </Field>

        <Field label="Phone">
          <input value={phone} onChange={(ev) => setPhone(ev.target.value)} className="input-luxe" />
        </Field>

        <Field label="Salary (major units)" required hint="Enter salary like 500.00">
          <input value={salary} onChange={(ev) => setSalary(ev.target.value)} className="input-luxe" />
          {errors.salary && <p className="mt-1 text-sm text-rose-600">{errors.salary}</p>}
        </Field>

        <Field label="Join date" required>
          <input value={joinDate} onChange={(ev) => setJoinDate(ev.target.value)} type="date" className="input-luxe" />
          {errors.joinDate && <p className="mt-1 text-sm text-rose-600">{errors.joinDate}</p>}
        </Field>

        {mode === "edit" && (
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived
            </label>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? (mode === "create" ? "Creating…" : "Saving…") : mode === "create" ? "Create employee" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
