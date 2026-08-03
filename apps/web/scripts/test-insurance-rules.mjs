/* eslint-disable no-console */

import assert from "node:assert/strict";

import {
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  getFirestore as getAdminFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import {
  deleteApp as deleteClientApp,
  initializeApp as initializeClientApp,
} from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  terminate,
  updateDoc,
} from "firebase/firestore";

const PROJECT_ID = "belt-kit";
const BRANCH_ID = "insurance-rules-branch";
const PASSWORD = "beltkit-rules-123";

const roles = ["owner", "manager", "advisor", "technician", "accountant"];

function emulatorAddress(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Run this test through Firebase emulators:exec.`);
  }
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(value)) {
    throw new Error(`Refusing non-loopback ${name}: ${value}`);
  }
  const separator = value.lastIndexOf(":");
  return {
    host: value.slice(0, separator),
    port: Number(value.slice(separator + 1)),
    value,
  };
}

const authEmulator = emulatorAddress("FIREBASE_AUTH_EMULATOR_HOST");
const firestoreEmulator = emulatorAddress("FIRESTORE_EMULATOR_HOST");

if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID) {
  throw new Error(
    `Refusing unexpected project ${process.env.GCLOUD_PROJECT}; expected ${PROJECT_ID}.`,
  );
}

const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "insurance-rules-admin");
const adminAuth = getAdminAuth(adminApp);
const adminDb = getAdminFirestore(adminApp);

const sessions = new Map();

function emailFor(role) {
  return `insurance-rules-${role}@example.test`;
}

async function createStaff(role) {
  const user = await adminAuth.createUser({
    email: emailFor(role),
    password: PASSWORD,
    displayName: `Insurance ${role}`,
    emailVerified: true,
  });

  await adminDb.collection("users").doc(user.uid).set({
    branchId: BRANCH_ID,
    role,
    displayName: `Insurance ${role}`,
    email: emailFor(role),
    active: true,
    createdAt: Timestamp.now(),
  });

  return user;
}

async function createSession(role, user) {
  const app = initializeClientApp(
    {
      apiKey: "fake-api-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    `insurance-rules-${role}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authEmulator.value}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, firestoreEmulator.host, firestoreEmulator.port);

  const credential = await signInWithEmailAndPassword(auth, emailFor(role), PASSWORD);
  assert.equal(credential.user.uid, user.uid, `${role} signed into the wrong test user`);

  const session = { app, auth, db, uid: user.uid };
  sessions.set(role, session);
  return session;
}

async function seedJob(
  jobId,
  status = "delivered",
  invoiceId = null,
  totalMinor = 0,
) {
  await adminDb.collection("jobCards").doc(jobId).set({
    branchId: BRANCH_ID,
    customerId: `customer-${jobId}`,
    vehicleId: `vehicle-${jobId}`,
    complaint: `Insurance rules test ${jobId}`,
    status,
    invoiceId,
    totalMinor,
    archived: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

function claimData(jobId, uid, overrides = {}) {
  return {
    schemaVersion: 2,
    branchId: BRANCH_ID,
    jobCardId: jobId,
    customerId: `customer-${jobId}`,
    vehicleId: `vehicle-${jobId}`,
    invoiceId: null,
    finalInvoiceId: null,
    companyName: "Rules Test Insurance PLC",
    policyNumber: `POL-${jobId}`,
    claimNumber: `CLM-${jobId}`,
    currency: "LKR",
    accidentDate: "2026-08-03",
    paymentRoute: "insurer_direct",
    caseStage: "intake",
    approvalStatus: "pending",
    releaseStatus: "blocked",
    settlementStatus: "not_due",
    documentStatus: "not_started",
    documentCount: 0,
    verifiedDocumentCount: 0,
    assessorName: "",
    assessmentDate: "",
    assessmentReference: "",
    finalInvoiceAmountMinor: 0,
    finalInvoiceTotalMinor: 0,
    claimAmountMinor: 0,
    assessedAmountMinor: 0,
    approvedAmountMinor: 0,
    insurerResponsibilityMinor: 0,
    customerResponsibilityMinor: 0,
    insurerReceivedMinor: 0,
    customerReceivedMinor: 0,
    receivedAmountMinor: 0,
    writeOffMinor: 0,
    releaseOrderNumber: "",
    releaseOrderDate: "",
    expectedSettlementDate: "",
    releasedAt: null,
    releasedByUid: null,
    status: "pending",
    notes: "",
    archived: false,
    createdByUid: uid,
    updatedByUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function expectAllowed(label, operation) {
  await operation();
  console.log(`PASS ${label}`);
}

async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    assert.match(
      String(error?.code ?? ""),
      /permission-denied/,
      `${label}: expected permission-denied, received ${error?.code ?? error}`,
    );
    console.log(`PASS ${label}`);
    return;
  }
  assert.fail(`${label}: operation unexpectedly succeeded`);
}

async function closeSessions() {
  for (const session of sessions.values()) {
    await signOut(session.auth).catch(() => undefined);
    await terminate(session.db).catch(() => undefined);
    await deleteClientApp(session.app).catch(() => undefined);
  }
  await deleteAdminApp(adminApp).catch(() => undefined);
}

async function main() {
  console.log(
    `Insurance rules test using Auth ${authEmulator.value} and Firestore ${firestoreEmulator.value}`,
  );

  const users = Object.fromEntries(
    await Promise.all(roles.map(async (role) => [role, await createStaff(role)])),
  );
  await Promise.all(
    roles.map((role) => createSession(role, users[role])),
  );

  const deliveredJobs = {
    owner: "insurance-job-owner",
    manager: "insurance-job-manager",
    advisor: "insurance-job-advisor",
    technician: "insurance-job-technician",
    accountant: "insurance-job-accountant",
  };
  await Promise.all([
    ...Object.values(deliveredJobs).map((jobId) => seedJob(jobId)),
    seedJob("insurance-job-not-delivered", "ready"),
    seedJob(
      "insurance-job-with-invoice",
      "delivered",
      "insurance-invoice-linked",
      125_000,
    ),
  ]);
  await adminDb.collection("invoices").doc("insurance-invoice-linked").set({
    branchId: BRANCH_ID,
    jobCardId: "insurance-job-with-invoice",
    customerId: "customer-insurance-job-with-invoice",
    status: "issued",
    totalMinor: 125_000,
  });

  for (const role of ["owner", "manager", "advisor"]) {
    const session = sessions.get(role);
    const jobId = deliveredJobs[role];
    const claimReference = doc(session.db, "insuranceClaims", jobId);

    await expectAllowed(`${role} creates a claim using doc ID == delivered Job Card ID`, () =>
      setDoc(claimReference, claimData(jobId, session.uid))
    );
    const stored = await adminDb.collection("insuranceClaims").doc(jobId).get();
    assert.equal(stored.exists, true);
    assert.equal(stored.id, stored.data().jobCardId);
    assert.equal(stored.data().finalInvoiceId, null);
    console.log(`PASS ${role} claim is deterministic and supports no invoice at intake`);

    await expectAllowed(`${role} reads an insurance case`, () => getDoc(claimReference));
    await expectAllowed(`${role} advances a valid case stage`, () =>
      updateDoc(claimReference, {
        caseStage: "documents",
        updatedByUid: session.uid,
        updatedAt: serverTimestamp(),
      })
    );
  }

  const ownerSession = sessions.get("owner");
  const linkedInvoiceClaim = doc(
    ownerSession.db,
    "insuranceClaims",
    "insurance-job-with-invoice",
  );
  await expectAllowed("owner creates a case linked to its final invoice", () =>
    setDoc(
      linkedInvoiceClaim,
      claimData("insurance-job-with-invoice", ownerSession.uid, {
        invoiceId: "insurance-invoice-linked",
        finalInvoiceId: "insurance-invoice-linked",
        finalInvoiceAmountMinor: 125_000,
        finalInvoiceTotalMinor: 125_000,
        claimAmountMinor: 125_000,
        assessedAmountMinor: 125_000,
        approvedAmountMinor: 100_000,
        insurerResponsibilityMinor: 100_000,
        customerResponsibilityMinor: 25_000,
      }),
    )
  );

  const ownerClaim = doc(
    ownerSession.db,
    "insuranceClaims",
    deliveredJobs.owner,
  );

  await expectDenied("a second create cannot replace the deterministic claim", () =>
    setDoc(ownerClaim, claimData(deliveredJobs.owner, ownerSession.uid))
  );
  await expectDenied("a claim document ID different from its Job Card ID is denied", () =>
    setDoc(
      doc(ownerSession.db, "insuranceClaims", "insurance-wrong-document-id"),
      claimData(deliveredJobs.manager, ownerSession.uid),
    )
  );
  await expectDenied("a claim for a non-delivered Job Card is denied", () =>
    setDoc(
      doc(ownerSession.db, "insuranceClaims", "insurance-job-not-delivered"),
      claimData("insurance-job-not-delivered", ownerSession.uid),
    )
  );

  const technicianSession = sessions.get("technician");
  await expectDenied("technician cannot read insurance cases", () =>
    getDoc(doc(technicianSession.db, "insuranceClaims", deliveredJobs.owner))
  );
  await expectDenied("technician cannot create insurance cases", () =>
    setDoc(
      doc(technicianSession.db, "insuranceClaims", deliveredJobs.technician),
      claimData(deliveredJobs.technician, technicianSession.uid),
    )
  );

  const accountantSession = sessions.get("accountant");
  const accountantView = doc(
    accountantSession.db,
    "insuranceClaims",
    deliveredJobs.owner,
  );
  await expectAllowed("accountant can read insurance cases", () => getDoc(accountantView));
  await expectAllowed("accountant can update settlement-only fields", () =>
    updateDoc(accountantView, {
      settlementStatus: "insurer_pending",
      expectedSettlementDate: "2026-08-10",
      updatedByUid: accountantSession.uid,
      updatedAt: serverTimestamp(),
    })
  );
  await expectDenied("accountant cannot update non-settlement claim fields", () =>
    updateDoc(accountantView, {
      companyName: "Accountant must not change the insurer",
      updatedByUid: accountantSession.uid,
      updatedAt: serverTimestamp(),
    })
  );
  await expectDenied("accountant cannot create insurance cases", () =>
    setDoc(
      doc(accountantSession.db, "insuranceClaims", deliveredJobs.accountant),
      claimData(deliveredJobs.accountant, accountantSession.uid),
    )
  );

  console.log("PASS all Insurance Firestore rule scenarios");
}

main()
  .catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  })
  .finally(closeSessions);
