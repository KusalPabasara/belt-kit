/**
 * BELT-KIT — Seed the default role accounts.
 * ----------------------------------------------------------------------------
 * Creates one user per role (owner, manager, advisor, technician, accountant)
 * with a shared demo password, sets their custom claims (role + branchId), and
 * writes a matching /users doc + the default branch.
 *
 * WHY a script: creating auth users and setting claims must use the Admin SDK,
 * which cannot run in the browser. This is the free way to bootstrap accounts
 * without deploying Cloud Functions (no Blaze plan needed).
 *
 * This script is deliberately emulator-only and idempotent. The root
 * `npm run dev` workflow starts the emulators and invokes it automatically.
 */

import admin from "firebase-admin";

const PROJECT_ID = "belt-kit";
const BRANCH_ID = "main-branch";
const DEMO_PASSWORD = "beltkit123";

const ACCOUNTS = [
  { role: "owner", email: "owner@beltkit.local", displayName: "Workshop Owner" },
  { role: "manager", email: "manager@beltkit.local", displayName: "Branch Manager" },
  { role: "advisor", email: "advisor@beltkit.local", displayName: "Service Advisor" },
  { role: "technician", email: "tech@beltkit.local", displayName: "Lead Technician" },
  { role: "accountant", email: "accounts@beltkit.local", displayName: "Cashier" },
  { role: "advisor", email: "notification-admin@test.com", displayName: "Notification Admin" },
  { role: "advisor", email: "local-notification-user@example.test", displayName: "Local Notification User" },
];

if (process.argv.includes("--cloud")) {
  throw new Error("[seed] Refusing --cloud: demo seeding is emulator-only.");
}

if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  throw new Error(
    "[seed] Refusing to run: FIREBASE_AUTH_EMULATOR_HOST and " +
    "FIRESTORE_EMULATOR_HOST must both be set.",
  );
}

const isLoopbackEmulator = (value) =>
  /^(127\.0\.0\.1|localhost):\d+$/.test(value ?? "");

if (
  !isLoopbackEmulator(process.env.FIRESTORE_EMULATOR_HOST) ||
  !isLoopbackEmulator(process.env.FIREBASE_AUTH_EMULATOR_HOST)
) {
  throw new Error("[seed] Refusing to run: emulator hosts must be loopback addresses.");
}

if (process.env.GCLOUD_PROJECT !== PROJECT_ID) {
  throw new Error(
    `[seed] Refusing unexpected project ${process.env.GCLOUD_PROJECT ?? "(unset)"}; ` +
    `expected ${PROJECT_ID}.`,
  );
}

admin.initializeApp({ projectId: PROJECT_ID });
console.log(
  `[seed] Using LOCAL EMULATOR (auth:${process.env.FIREBASE_AUTH_EMULATOR_HOST}, ` +
  `firestore:${process.env.FIRESTORE_EMULATOR_HOST})`,
);

const auth = admin.auth();
const db = admin.firestore();

async function ensureUser(acc) {
  let userRecord;
  let created = false;
  const repairs = [];
  try {
    userRecord = await auth.getUserByEmail(acc.email);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    userRecord = await auth.createUser({
      email: acc.email,
      password: DEMO_PASSWORD,
      displayName: acc.displayName,
      emailVerified: true,
    });
    created = true;
  }

  if (!created) {
    if (userRecord.displayName !== acc.displayName) repairs.push("Auth display name");
    if (!userRecord.emailVerified) repairs.push("Auth email verification");
    if (userRecord.disabled) repairs.push("Auth disabled state");
    if (!(await passwordWorks(acc.email))) repairs.push("Auth password");

    // Resetting the password is intentional: every normal start repairs demo
    // credentials even though Firebase Admin cannot read password hashes.
    userRecord = await auth.updateUser(userRecord.uid, {
      email: acc.email,
      password: DEMO_PASSWORD,
      displayName: acc.displayName,
      emailVerified: true,
      disabled: false,
    });
  }

  // Set role + branch as custom claims (what the security rules trust).
  const existingClaims = userRecord.customClaims ?? {};
  if (existingClaims.role !== acc.role || existingClaims.branchId !== BRANCH_ID) {
    repairs.push("Auth claims");
    await auth.setCustomUserClaims(userRecord.uid, {
      ...existingClaims,
      role: acc.role,
      branchId: BRANCH_ID,
    });
  }

  // Mirror into Firestore so the Users screen can list them.
  const profileReference = db.collection("users").doc(userRecord.uid);
  const staleProfiles = await db
    .collection("users")
    .where("email", "==", acc.email)
    .get();
  for (const staleProfile of staleProfiles.docs) {
    if (staleProfile.id !== userRecord.uid) {
      await staleProfile.ref.delete();
      repairs.push("stale demo profile");
    }
  }
  const existingProfile = await profileReference.get();
  const profile = existingProfile.data();
  if (!existingProfile.exists) repairs.push("Firestore profile");
  else if (
    profile?.branchId !== BRANCH_ID ||
    profile?.role !== acc.role ||
    profile?.displayName !== acc.displayName ||
    profile?.email !== acc.email ||
    profile?.active !== true ||
    !profile?.createdAt
  ) repairs.push("Firestore profile");

  await profileReference.set(
    {
      branchId: BRANCH_ID,
      role: acc.role,
      displayName: acc.displayName,
      email: acc.email,
      active: true,
      createdAt:
        existingProfile.data()?.createdAt ??
        admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const outcome = created ? "created" : repairs.length ? `repaired ${repairs.join(", ")}` : "already valid";
  console.log(`[seed] ${acc.email}: ${outcome}`);
}

async function signIn(acc) {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}` +
    "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: acc.email,
        password: DEMO_PASSWORD,
        returnSecureToken: true,
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`[seed] ${acc.email}: sign-in verification failed: ${body?.error?.message ?? response.status}`);
  }
  return body;
}

async function passwordWorks(email) {
  try {
    await signIn({ email });
    return true;
  } catch {
    return false;
  }
}

async function verifyUser(acc) {
  const userRecord = await auth.getUserByEmail(acc.email);
  const profile = (await db.collection("users").doc(userRecord.uid).get()).data();
  const claims = userRecord.customClaims ?? {};
  if (
    profile?.email !== acc.email ||
    profile?.displayName !== acc.displayName ||
    profile?.role !== acc.role ||
    profile?.branchId !== BRANCH_ID ||
    profile?.active !== true ||
    claims.role !== acc.role ||
    claims.branchId !== BRANCH_ID
  ) {
    throw new Error(`Demo account verification failed: ${acc.email}`);
  }
  const session = await signIn(acc);
  const decodedToken = await auth.verifyIdToken(session.idToken);
  if (
    session.localId !== userRecord.uid ||
    decodedToken.role !== acc.role ||
    decodedToken.branchId !== BRANCH_ID
  ) {
    throw new Error(`[seed] ${acc.email}: fresh-token claims verification failed.`);
  }
  console.log(`[seed] ${acc.email}: verified login, profile, and fresh claims`);
  return userRecord.uid;
}

function timestampDaysAgo(daysAgo, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return admin.firestore.Timestamp.fromDate(date);
}

async function seedDemoData(userIds) {
  const ownerUid = userIds.get("owner");
  const technicianUid = userIds.get("technician");
  const now = admin.firestore.FieldValue.serverTimestamp();

  const customers = [
    ["customer-perera", { displayName: "Nimal Perera", phone: "0771234567", email: "nimal@example.test", preferredChannel: "whatsapp", segment: "vip" }],
    ["customer-silva", { displayName: "Shenali Silva", phone: "0719876543", email: "shenali@example.test", preferredChannel: "sms", segment: "walkin" }],
    ["customer-fernando", { displayName: "Ruwan Fernando", phone: "0765558123", email: "ruwan@example.test", preferredChannel: "email", segment: "fleet" }],
  ];
  const vehicles = [
    ["vehicle-perera", { customerId: "customer-perera", plateNumber: "CAB-4821", make: "Toyota", model: "Aqua", year: 2016, engine: "1500cc Hybrid", odometerReading: 68420, fuelLevel: "Half", existingDamage: { scratches: true, dents: false, crackedGlass: false, notes: "Light scratch on rear bumper." } }],
    ["vehicle-silva", { customerId: "customer-silva", plateNumber: "CAA-9087", make: "Honda", model: "Fit", year: 2015, engine: "1300cc", odometerReading: 92110, fuelLevel: "Quarter", existingDamage: { scratches: false, dents: true, crackedGlass: false, notes: "Small dent on left front door." } }],
    ["vehicle-fernando", { customerId: "customer-fernando", plateNumber: "CAR-3310", make: "Suzuki", model: "Wagon R", year: 2018, engine: "1000cc", odometerReading: 45780, fuelLevel: "Half", existingDamage: { scratches: false, dents: false, crackedGlass: false, notes: "" } }],
  ];
  const parts = [
    ["part-engine-oil", { sku: "OIL-5W30", name: "Engine Oil 5W-30", costPriceMinor: 220000, sellPriceMinor: 350000, quantityOnHand: 18, reorderThreshold: 10, lowStock: false, binLocation: "A-01" }],
    ["part-oil-filter", { sku: "OF-1023", name: "Oil Filter", costPriceMinor: 180000, sellPriceMinor: 300000, quantityOnHand: 6, reorderThreshold: 5, lowStock: false, binLocation: "A-02" }],
    ["part-brake-pad", { sku: "BP-445", name: "Front Brake Pad Set", costPriceMinor: 650000, sellPriceMinor: 950000, quantityOnHand: 2, reorderThreshold: 4, lowStock: true, binLocation: "B-04" }],
    ["part-air-filter", { sku: "AF-210", name: "Air Filter", costPriceMinor: 145000, sellPriceMinor: 240000, quantityOnHand: 0, reorderThreshold: 3, lowStock: true, binLocation: "A-05" }],
  ];
  const services = [
    ["service-body-wash", { name: "Body Wash", defaultPriceMinor: 500000, estimatedDays: 1, active: true }],
    ["service-full-service", { name: "Full Service", defaultPriceMinor: 1500000, estimatedDays: 2, active: true }],
    ["service-repair", { name: "General Repair", defaultPriceMinor: 2500000, estimatedDays: 5, active: true }],
    ["service-engine-diagnostics", { name: "Engine Diagnostics", defaultPriceMinor: 800000, estimatedDays: 1, active: true }],
    ["service-brake-repair", { name: "Brake Inspection & Repair", defaultPriceMinor: 1450000, estimatedDays: 2, active: true }],
    ["service-paint", { name: "Paint", defaultPriceMinor: 5000000, estimatedDays: 7, active: true }],
  ];

  const writeBatch = db.batch();
  customers.forEach(([id, data]) => writeBatch.set(db.collection("customers").doc(id), {
    ...data, branchId: BRANCH_ID, archived: false, createdAt: timestampDaysAgo(30), updatedAt: now,
  }, { merge: true }));
  vehicles.forEach(([id, data]) => writeBatch.set(db.collection("vehicles").doc(id), {
    ...data, branchId: BRANCH_ID, archived: false, createdAt: timestampDaysAgo(28), updatedAt: now,
  }, { merge: true }));
  parts.forEach(([id, data]) => writeBatch.set(db.collection("parts").doc(id), {
    ...data, branchId: BRANCH_ID, archived: false, createdAt: timestampDaysAgo(20), updatedAt: now,
  }, { merge: true }));
  services.forEach(([id, data]) => writeBatch.set(db.collection("services").doc(id), {
    ...data, branchId: BRANCH_ID, archived: false, createdAt: timestampDaysAgo(20), updatedAt: now,
  }, { merge: true }));
  await writeBatch.commit();

  const jobs = [
    ["job-service-paid", {
      customerId: "customer-perera", vehicleId: "vehicle-perera", complaint: "Regular service and AC cleaning", status: "delivered",
      serviceTypeIds: ["service-full-service"],
      assignedTechnicianIds: technicianUid ? [technicianUid] : [], subtotalMinor: 2200000, taxMinor: 418950, totalMinor: 2746450,
      invoiceId: "invoice-service-paid", createdAt: timestampDaysAgo(12), updatedAt: now,
    }],
    ["job-brakes-partpaid", {
      customerId: "customer-silva", vehicleId: "vehicle-silva", complaint: "Front brake noise when stopping", status: "ready",
      serviceTypeIds: ["service-brake-repair"],
      assignedTechnicianIds: technicianUid ? [technicianUid] : [], subtotalMinor: 1450000, taxMinor: 261000, totalMinor: 1711000,
      invoiceId: "invoice-brakes-partpaid", createdAt: timestampDaysAgo(7), updatedAt: now,
    }],
    ["job-diagnosis-open", {
      customerId: "customer-fernando", vehicleId: "vehicle-fernando", complaint: "Check engine light and rough idle", status: "in_progress",
      serviceTypeIds: ["service-engine-diagnostics"],
      assignedTechnicianIds: technicianUid ? [technicianUid] : [], subtotalMinor: 800000, taxMinor: 144000, totalMinor: 944000,
      invoiceId: null, createdAt: timestampDaysAgo(1), updatedAt: now,
    }],
    ["job-invoice-demo-open", {
      customerId: "customer-perera", vehicleId: "vehicle-perera", complaint: "Invoice demo — service package ready for pricing", status: "ready",
      serviceTypeIds: ["service-full-service"],
      assignedTechnicianIds: technicianUid ? [technicianUid] : [], subtotalMinor: 650000, taxMinor: 117000, totalMinor: 767000,
      invoiceId: null, createdAt: timestampDaysAgo(0, 9), updatedAt: now,
    }],
  ];

  const jobLines = [
    ["line-service-oil", { jobCardId: "job-service-paid", kind: "part", description: "Engine Oil 5W-30", partId: "part-engine-oil", quantity: 4, unitPriceMinor: 350000, lineTotalMinor: 1400000 }],
    ["line-service-filter", { jobCardId: "job-service-paid", kind: "part", description: "Oil Filter", partId: "part-oil-filter", quantity: 1, unitPriceMinor: 300000, lineTotalMinor: 300000 }],
    ["line-service-labour", { jobCardId: "job-service-paid", kind: "labor", serviceTypeId: "service-full-service", description: "Full service labour", quantity: 1, unitPriceMinor: 500000, lineTotalMinor: 500000 }],
    ["line-brakes-pad", { jobCardId: "job-brakes-partpaid", kind: "part", description: "Front Brake Pad Set", partId: "part-brake-pad", quantity: 1, unitPriceMinor: 950000, lineTotalMinor: 950000 }],
    ["line-brakes-labour", { jobCardId: "job-brakes-partpaid", kind: "labor", serviceTypeId: "service-brake-repair", description: "Brake inspection and fitting", quantity: 1, unitPriceMinor: 500000, lineTotalMinor: 500000 }],
    ["line-diagnosis", { jobCardId: "job-diagnosis-open", kind: "labor", serviceTypeId: "service-engine-diagnostics", description: "Engine diagnostics", quantity: 1, unitPriceMinor: 800000, lineTotalMinor: 800000 }],
    ["line-invoice-demo-filter", { jobCardId: "job-invoice-demo-open", kind: "part", description: "Oil Filter", partId: "part-oil-filter", quantity: 1, unitPriceMinor: 300000, lineTotalMinor: 300000 }],
    ["line-invoice-demo-labour", { jobCardId: "job-invoice-demo-open", kind: "labor", serviceTypeId: "service-full-service", description: "Service and inspection labour", quantity: 1, unitPriceMinor: 350000, lineTotalMinor: 350000 }],
  ];

  const invoiceLines = {
    service: [
      { description: "Engine Oil 5W-30", quantity: 4, unitPriceMinor: 350000, lineTotalMinor: 1400000, kind: "part", partId: "part-engine-oil", costPriceMinor: 220000 },
      { description: "Oil Filter", quantity: 1, unitPriceMinor: 300000, lineTotalMinor: 300000, kind: "part", partId: "part-oil-filter", costPriceMinor: 180000 },
      { description: "Full service labour", quantity: 1, unitPriceMinor: 500000, lineTotalMinor: 500000, kind: "labor" },
    ],
    brakes: [
      { description: "Front Brake Pad Set", quantity: 1, unitPriceMinor: 950000, lineTotalMinor: 950000, kind: "part", partId: "part-brake-pad", costPriceMinor: 650000 },
      { description: "Brake inspection and fitting", quantity: 1, unitPriceMinor: 500000, lineTotalMinor: 500000, kind: "labor" },
    ],
  };

  const financialBatch = db.batch();
  jobs.forEach(([id, data]) => financialBatch.set(db.collection("jobCards").doc(id), {
    ...data, branchId: BRANCH_ID, archived: false, createdByUid: ownerUid ?? "seed", updatedByUid: ownerUid ?? "seed",
  }, { merge: true }));
  jobLines.forEach(([id, data]) => financialBatch.set(db.collection("jobCardLines").doc(id), {
    ...data, branchId: BRANCH_ID, archived: false, createdAt: timestampDaysAgo(10), updatedAt: now,
  }, { merge: true }));
  financialBatch.set(db.collection("invoices").doc("invoice-service-paid"), {
    branchId: BRANCH_ID, jobCardId: "job-service-paid", customerId: "customer-perera", status: "paid", currency: "LKR",
    subtotalMinor: 2200000, extraCharges: [{ description: "AC cleaning", amountMinor: 250000 }], discountType: "percent", discountValue: 5,
    discountMinor: 122500, taxRatePercent: 18, taxMinor: 418950, totalMinor: 2746450, amountPaidMinor: 2746450,
    lines: invoiceLines.service, archived: false, createdByUid: ownerUid ?? "seed", createdAt: timestampDaysAgo(12), updatedAt: now,
  }, { merge: true });
  financialBatch.set(db.collection("invoices").doc("invoice-brakes-partpaid"), {
    branchId: BRANCH_ID, jobCardId: "job-brakes-partpaid", customerId: "customer-silva", status: "part_paid", currency: "LKR",
    subtotalMinor: 1450000, extraCharges: [], discountType: "fixed", discountValue: 0, discountMinor: 0,
    taxRatePercent: 18, taxMinor: 261000, totalMinor: 1711000, amountPaidMinor: 700000,
    lines: invoiceLines.brakes, archived: false, createdByUid: ownerUid ?? "seed", createdAt: timestampDaysAgo(7), updatedAt: now,
  }, { merge: true });
  financialBatch.set(db.collection("payments").doc("payment-service-card"), {
    branchId: BRANCH_ID, invoiceId: "invoice-service-paid", customerId: "customer-perera", amountMinor: 2746450, method: "card",
    reference: "DEMO-CARD-SERVICE-01", cardLast4: "4242", provider: "Demo card payment", archived: false,
    createdByUid: ownerUid ?? "seed", createdAt: timestampDaysAgo(9), updatedAt: now,
  }, { merge: true });
  financialBatch.set(db.collection("payments").doc("payment-brakes-cash"), {
    branchId: BRANCH_ID, invoiceId: "invoice-brakes-partpaid", customerId: "customer-silva", amountMinor: 700000, method: "cash",
    reference: "CASH-DEMO-02", provider: "Cash counter", archived: false,
    createdByUid: ownerUid ?? "seed", createdAt: timestampDaysAgo(4), updatedAt: now,
  }, { merge: true });
  financialBatch.set(db.collection("stockMovements").doc("movement-oil-received"), {
    branchId: BRANCH_ID, partId: "part-engine-oil", delta: 12, reason: "purchase", jobCardId: null, archived: false,
    createdAt: timestampDaysAgo(8), updatedAt: now,
  }, { merge: true });
  financialBatch.set(db.collection("stockMovements").doc("movement-brake-adjustment"), {
    branchId: BRANCH_ID, partId: "part-brake-pad", delta: -1, reason: "adjustment", jobCardId: "job-brakes-partpaid", archived: false,
    createdAt: timestampDaysAgo(6), updatedAt: now,
  }, { merge: true });
  financialBatch.set(db.collection("auditLog").doc("audit-demo-payment"), {
    branchId: BRANCH_ID, actorUid: ownerUid ?? "seed", action: "payment.created", entityType: "payment", entityId: "payment-service-card",
    after: { invoiceId: "invoice-service-paid", amountMinor: 2746450, method: "card" }, at: timestampDaysAgo(9),
  }, { merge: true });
  await financialBatch.commit();

  console.log("  ✓ mock customers, vehicles, inventory, job cards, invoices and payments ready");
}

async function main() {
  // Default branch (Sri Lanka defaults).
  const branchReference = db.collection("branches").doc(BRANCH_ID);
  const existingBranch = await branchReference.get();
  await db.collection("branches").doc(BRANCH_ID).set(
    {
      name: "Main Branch",
      currency: "LKR",
      taxRatePercent: 18, // Sri Lanka VAT (adjust as needed)
      timezone: "Asia/Colombo",
      createdAt:
        existingBranch.data()?.createdAt ??
        admin.firestore.FieldValue.serverTimestamp(),
      archived: false,
    },
    { merge: true }
  );
  console.log(`[seed] Branch ready: ${BRANCH_ID} (LKR, Asia/Colombo)`);

  const userIds = new Map();
  for (const acc of ACCOUNTS) {
    userIds.set(acc.role, await ensureUser(acc));
  }

  for (const acc of ACCOUNTS) {
    await verifyUser(acc);
  }

  console.log("[seed] All demo accounts ready");

  await seedDemoData(userIds);

  console.log("\n  Done. Sign in with any email above + password:", DEMO_PASSWORD, "\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
