"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";
import {
  UserCog,
  UserPlus,
  Pencil,
  Check,
  X,
  ShieldCheck,
  Loader2,
  Info,
  UserX,
  UserCheck,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth, Role } from "@/lib/auth-context";
import { createStaffMember } from "@/lib/create-user";
import { canManageUsers } from "@/lib/permissions";
import { Modal, Field, GearLoader, useToast } from "@/components/ui";
import { ROLE_META, DEFAULT_ACCOUNTS, DEMO_PASSWORD } from "@/lib/roles";

interface UserRow {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  branchId: string;
  active: boolean;
}

// Roles that can be ASSIGNED to new/edited members.
// Per requirement: Admin (owner), Front Desk (advisor) and Technician only.
// Manager/accountant still work for existing accounts, but aren't offered here.
const ASSIGNABLE_ROLES: Role[] = ["owner", "advisor", "technician"];

export default function UsersPage() {
  const { role } = useAuth();
  const { notify } = useToast();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] = useState<Role>("advisor");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [draftEmail, setDraftEmail] = useState("");

  const canAdd = canManageUsers(role);
  const validateName = (name: string) => {
  return /^[A-Za-z\s]+$/.test(name.trim());
};

async function reactivateUser(id:string){

  try{

    await updateDoc(
      doc(db,"users",id),
      {
        active:true
      }
    );

    notify("Member reactivated.");

  }catch{

    notify(
      "Could not reactivate member.",
      "error"
    );

  }

}

async function deactivateUser(id:string){

  try{

    await updateDoc(
      doc(db,"users",id),
      {
        active:false
      }
    );

    notify("Member deactivated.");

  }catch{

    notify(
      "Could not deactivate member.",
      "error"
    );

  }

}

  async function handleAddMember(form: FormData) {
    setAddBusy(true);
    setAddErr(null);
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const newRole = String(form.get("role") || "technician") as Role;
    if (!name) {
  setAddErr("Name is required.");
  setAddBusy(false);
  return;
}


if (!validateName(name)) {
  setAddErr(
    "Name should contain only letters and spaces."
  );
  setAddBusy(false);
  return;
}


if (!email || password.length < 6) {
  setAddErr(
    "Email and a password of at least 6 characters are required."
  );
  setAddBusy(false);
  return;
}
    try {
      await createStaffMember({ name, email, password, role: newRole, branchId: "main" });
      notify("Member added. They can sign in now.");
      setAddOpen(false);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      setAddErr(
        code.includes("email-already-in-use")
          ? "That email already has an account."
          : code.includes("invalid-email")
          ? "That email looks invalid."
          : "Could not create the account."
      );
    } finally {
      setAddBusy(false);
    }
  }

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        setRows(
  snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<UserRow, "id">)
  }))
);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  function startEdit(row: UserRow) {
  setEditingId(row.id);
  setDraftName(row.displayName);
  setDraftEmail(row.email);
  setDraftRole(row.role);
  setNotice(null);
}

  async function saveEdit(row: UserRow) {

  if (!draftName.trim()) {
    setNotice("Name is required.");
    return;
  }

  if (!validateName(draftName)) {
    setNotice("Name should contain only letters and spaces.");
    return;
  }

  if (!draftEmail.trim()) {
    setNotice("Email is required.");
    return;
  }

  setSavingId(row.id);
  setNotice(null);

  try {

    await updateDoc(
      doc(db, "users", row.id),
      {
        displayName: draftName.trim(),
        email: draftEmail.trim(),
        role: draftRole
      }
    );

    setEditingId(null);

  } catch {

    setNotice("Could not save changes.");

  } finally {

    setSavingId(null);

  }
}
  const canEdit = role === "owner" || role === "manager" || role === "advisor";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-burgundy-600">
            Administration
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold tracking-tight text-ink">
            <UserCog className="text-burgundy-500" size={26} />
            Users &amp; Roles
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Assign roles to staff. Roles offered: Admin, Front Desk and Technician.
          </p>
        </div>
        {canAdd && (
          <button onClick={() => { setAddErr(null); setAddOpen(true); }} className="btn-primary shrink-0">
            <UserPlus size={18} /> Add Member
          </button>
        )}
      </div>

      {/* Default credentials reference */}
      <div className="card mb-6 p-6">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck size={18} className="text-burgundy-500" />
          <h2 className="text-base font-semibold text-ink">Default sign-in credentials</h2>
        </div>
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Password</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {DEFAULT_ACCOUNTS.map((a) => (
                <tr key={a.email} className="bg-white">
                  <td className="px-4 py-3 font-medium text-ink">{ROLE_META[a.role].label}</td>
                  <td className="px-4 py-3 text-ink-soft">{a.email}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-surface-muted px-2 py-0.5 text-xs text-burgundy-600">
                      {DEMO_PASSWORD}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs text-ink-faint">
          <Info size={14} className="mt-0.5 shrink-0" />
          These are demo defaults. Change the password for any account before going live.
        </p>
      </div>

      {/* Live users from Firestore */}
      <div className="card p-6">
        <h2 className="mb-4 text-base font-semibold text-ink">Active accounts</h2>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <GearLoader size={40} />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl bg-surface-muted px-5 py-8 text-center">
            <p className="text-sm text-ink-soft">
              No accounts yet. Run{" "}
              <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-burgundy-600">npm run seed</code>{" "}
              in the functions folder to create the default role accounts.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row, i) => (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rosegold-sheen text-sm font-semibold text-white">
                    {(row.displayName || row.email || "?")[0]?.toUpperCase()}
                  </div>
                  <div>
                    {editingId === row.id ? (
                      <input
 value={draftName}
 onChange={(e) =>
   setDraftName(
     e.target.value.replace(
       /[^A-Za-z\s]/g,
       ""
     )
   )
 }
 className="input-luxe py-1.5 text-sm"
 autoFocus
/>
                    ) : (
                      <p className="font-medium text-ink">{row.displayName || "Unnamed"}</p>
                    )}
                    {editingId === row.id ? (
  <input
    value={draftEmail}
    onChange={(e)=>setDraftEmail(e.target.value)}
    className="input-luxe py-1.5 text-sm mt-2"
    type="email"
  />
) : (
  <p className="text-xs text-ink-faint">{row.email}</p>
)}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {editingId === row.id ? (
                    <select
                      value={draftRole}
                      onChange={(e) => setDraftRole(e.target.value as Role)}
                      className="input-luxe py-1.5 text-sm"
                    >
                      {Array.from(new Set([...ASSIGNABLE_ROLES, row.role])).map((r) => (
                        <option key={r} value={r}>{ROLE_META[r].label}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex flex-col gap-2">

<span className="rounded-full bg-burgundy-50 px-3 py-1 text-xs font-medium text-burgundy-600">
  {ROLE_META[row.role]?.label ?? row.role}
</span>

{row.active === false && (
  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
    Deactivated
  </span>
)}

</div>
                  )}

                  {canEdit &&
                    (editingId === row.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => saveEdit(row)}
                          disabled={savingId === row.id}
                          className="rounded-lg bg-burgundy-600 p-2 text-white transition hover:bg-burgundy-700"
                          aria-label="Save"
                        >
                          {savingId === row.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-line p-2 text-ink-soft transition hover:text-burgundy-600"
                          aria-label="Cancel"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
  <>
    <button
      onClick={() => {
  if(row.active !== false){
    startEdit(row);
  }
}}
      className="rounded-lg border border-line p-2 text-ink-soft transition hover:border-burgundy-300 hover:text-burgundy-600"
      aria-label="Edit"
    >
      <Pencil size={16} />
    </button>

    {row.active === false ? (

<button
  onClick={() => reactivateUser(row.id)}
  className="rounded-lg border border-line p-2 text-ink-soft transition hover:border-green-300 hover:text-green-600"
  aria-label="Reactivate"
  title="Reactivate member"
>
  <UserCheck size={16}/>
</button>

) : (

<button
  onClick={()=>{
    if(confirm("Deactivate this member?")){
      deactivateUser(row.id);
    }
  }}
  className="rounded-lg border border-line p-2 text-ink-soft transition hover:border-red-300 hover:text-red-600"
  aria-label="Deactivate"
  title="Deactivate member"
>
  <UserX size={16}/>
</button>

)}
  </>
))}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {notice && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 flex items-start gap-2 rounded-xl bg-surface-muted px-4 py-3 text-xs text-ink-soft"
          >
            <Info size={14} className="mt-0.5 shrink-0 text-burgundy-500" />
            {notice}
          </motion.p>
        )}
      </div>

      {/* Add Member modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a staff member">
        <form
          onSubmit={(e) => { e.preventDefault(); handleAddMember(new FormData(e.currentTarget)); }}
          className="space-y-4"
        >
          <Field label="Full name" required>
            <input
 name="name"
 className="input-luxe"
 placeholder="e.g. Kasun Silva"
 onChange={(e)=>{
   e.target.value =
     e.target.value.replace(
       /[^A-Za-z\s]/g,
       ""
     );
 }}
/>
          </Field>
          <Field label="Email (this is their login)" required>
            <input name="email" type="email" className="input-luxe" placeholder="person@garage.lk" />
          </Field>
          <Field label="Password" required hint="At least 6 characters. Share this with them.">
            <input name="password" className="input-luxe" placeholder="temporary password" />
          </Field>
          <Field label="Role" required>
            <select name="role" defaultValue="technician" className="input-luxe">
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_META[r].label}</option>
              ))}
            </select>
          </Field>

          {addErr && (
            <p className="rounded-lg bg-burgundy-50 px-3.5 py-2.5 text-sm text-burgundy-600">{addErr}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setAddOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={addBusy} className="btn-primary">
              {addBusy ? "Creating…" : "Create member"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
