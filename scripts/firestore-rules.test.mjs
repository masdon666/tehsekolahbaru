import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from '@firebase/firestore';

const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const testEnvironment = await initializeTestEnvironment({
  projectId: 'demo-catatan-rules',
  firestore: { rules },
});

try {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, 'users/owner-a'), {
        uid: 'owner-a',
        email: 'owner@example.test',
        name: 'Owner',
        role: 'owner',
        businessId: 'business-a',
        status: 'active',
      }),
      setDoc(doc(firestore, 'users/owner-b'), {
        uid: 'owner-b',
        email: 'owner-b@example.test',
        name: 'Other Owner',
        role: 'owner',
        businessId: 'business-b',
        status: 'active',
      }),
      setDoc(doc(firestore, 'businesses/business-a'), {
        id: 'business-a',
        ownerId: 'owner-a',
      }),
      setDoc(doc(firestore, 'businesses/business-b'), {
        id: 'business-b',
        ownerId: 'owner-b',
      }),
      setDoc(doc(firestore, 'businesses/business-a/users/owner-a'), {
        uid: 'owner-a',
        role: 'owner',
        businessId: 'business-a',
        active: true,
        status: 'active',
      }),
      setDoc(doc(firestore, 'businesses/business-b/users/owner-b'), {
        uid: 'owner-b',
        role: 'owner',
        businessId: 'business-b',
        active: true,
        status: 'active',
      }),
      setDoc(doc(firestore, 'businesses/business-a/users/employee-a'), {
        uid: 'employee-a',
        authUid: 'employee-a',
        employeeId: 'EMP001',
        name: 'Employee A',
        role: 'employee',
        businessId: 'business-a',
        email: 'emp001@internal.catatanusaha.app',
        active: true,
        status: 'active',
      }),
      setDoc(doc(firestore, 'businesses/business-a/users/employee-b'), {
        uid: 'employee-b',
        authUid: 'employee-b',
        employeeId: 'EMP002',
        name: 'Employee B',
        role: 'employee',
        businessId: 'business-a',
        email: 'emp002@internal.catatanusaha.app',
        active: true,
        status: 'active',
      }),
      setDoc(doc(firestore, 'users/employee-a'), {
        uid: 'employee-a',
        authUid: 'employee-a',
        employeeId: 'EMP001',
        name: 'Employee A',
        role: 'employee',
        businessId: 'business-a',
        email: 'emp001@internal.catatanusaha.app',
        active: true,
        status: 'active',
      }),
      setDoc(doc(firestore, 'users/employee-b'), {
        uid: 'employee-b',
        authUid: 'employee-b',
        employeeId: 'EMP002',
        name: 'Employee B',
        role: 'employee',
        businessId: 'business-a',
        email: 'emp002@internal.catatanusaha.app',
        active: true,
        status: 'active',
      }),
      setDoc(doc(firestore, 'businesses/business-a/purchases/purchase-a'), { cost: 100 }),
      setDoc(doc(firestore, 'businesses/business-a/capital/capital-a'), { amount: 100 }),
      setDoc(doc(firestore, 'businesses/business-a/salesPrivate/sale-a'), { hpp: 10 }),
      setDoc(doc(firestore, 'businesses/business-a/settings/profile'), { businessName: 'Business A' }),
      setDoc(doc(firestore, 'businesses/business-a/reports/month'), { profit: 50 }),
    ]);
  });

  const unauthenticated = testEnvironment.unauthenticatedContext().firestore();
  const owner = testEnvironment.authenticatedContext('owner-a', { email: 'owner@example.test' }).firestore();
  const otherOwner = testEnvironment.authenticatedContext('owner-b', { email: 'owner-b@example.test' }).firestore();
  const employee = testEnvironment.authenticatedContext('employee-a', { email: 'employee@example.test' }).firestore();

  await assertFails(getDoc(doc(unauthenticated, 'users/owner-a')), 'A: unauthenticated user cannot read owner profile');
  await assertSucceeds(getDoc(doc(owner, 'users/owner-a')), 'B: owner can read own profile');
  await assertSucceeds(getDoc(doc(owner, 'businesses/business-a')), 'C: owner can read own business');
  await assertFails(getDoc(doc(owner, 'businesses/business-b')), 'D: owner cannot read another business');
  await assertSucceeds(
    getDoc(doc(employee, 'businesses/business-a/users/employee-a')),
    'E: employee can read own membership profile',
  );
  await assertSucceeds(getDoc(doc(employee, 'users/employee-a')), 'E: employee can read own root profile');
  await assertSucceeds(getDoc(doc(owner, 'users/employee-a')), 'Owner can read employee profile in own business');
  await assertFails(getDoc(doc(employee, 'users/owner-a')), 'F: employee cannot read owner profile');
  await assertFails(
    getDoc(doc(employee, 'businesses/business-a/users/employee-b')),
    'G: employee cannot read another employee profile',
  );
  await assertFails(getDoc(doc(employee, 'users/employee-b')), 'G: employee cannot read another root employee profile');
  await Promise.all([
    assertFails(getDoc(doc(employee, 'businesses/business-a/purchases/purchase-a')), 'H: employee cannot read purchases'),
    assertFails(getDoc(doc(employee, 'businesses/business-a/capital/capital-a')), 'H: employee cannot read capital'),
    assertFails(getDoc(doc(employee, 'businesses/business-a/salesPrivate/sale-a')), 'H: employee cannot read HPP'),
    assertFails(getDoc(doc(employee, 'businesses/business-a/settings/profile')), 'H: employee cannot read settings'),
    assertFails(getDoc(doc(employee, 'businesses/business-a/reports/month')), 'H: employee cannot read reports'),
  ]);

  const registeringOwner = testEnvironment.authenticatedContext(
    'new-owner',
    { email: 'new-owner@example.test' },
  ).firestore();
  const businessId = 'random-business-id';
  const batch = writeBatch(registeringOwner);
  batch.set(doc(registeringOwner, 'users/new-owner'), {
    uid: 'new-owner',
    email: 'new-owner@example.test',
    name: 'New Owner',
    role: 'owner',
    businessId,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  batch.set(doc(registeringOwner, `businesses/${businessId}`), {
    id: businessId,
    ownerId: 'new-owner',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  batch.set(doc(registeringOwner, `businesses/${businessId}/users/new-owner`), {
    uid: 'new-owner',
    email: 'new-owner@example.test',
    name: 'New Owner',
    role: 'owner',
    businessId,
    status: 'active',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  batch.set(doc(registeringOwner, `businesses/${businessId}/settings/profile`), {
    businessName: 'New Business',
    ownerName: 'New Owner',
    currency: 'IDR',
    businessId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const seedMenus = [
    ['es-teh-ori-1000', 'Es Teh Ori 1000', 1000],
    ['es-teh-ori-2000', 'Es Teh Ori 2000', 2000],
    ['es-teh-ori-3000', 'Es Teh Ori 3000', 3000],
    ['matcha', 'Matcha', 5000],
    ['teh-susu', 'Teh Susu', 5000],
    ['nutrisari', 'Nutrisari', 3000],
    ['gday-latte', 'Gday Latte', 5000],
    ['gday-coolin', 'Gday Coolin', 5000],
    ['drink-bengbeng', 'Drink Bengbeng', 5000],
    ['pink-lava', 'Pink Lava', 5000],
    ['americano', 'Americano', 5000],
    ['kopi-gula-aren', 'Kopi Gula Aren', 5000],
  ];
  for (const [id, name, sellingPrice] of seedMenus) {
    batch.set(doc(registeringOwner, `businesses/${businessId}/menus/${id}`), {
      id,
      name,
      category: 'Minuman',
      purchasePrice: 0,
      sellingPrice,
      status: 'aktif',
      createdBy: 'new-owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    batch.set(doc(registeringOwner, `businesses/${businessId}/cashierMenus/${id}`), {
      id,
      name,
      category: 'Minuman',
      sellingPrice,
      status: 'aktif',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  await assertSucceeds(batch.commit(), 'Register: owner onboarding batch creates profile, business, membership, and seed data');

  const newEmployeeBatch = writeBatch(owner);
  const employeeUid = 'employee-new';
  const employeeEmail = 'new01@internal.catatanusaha.app';
  const employeeRecord = {
    uid: employeeUid,
    authUid: employeeUid,
    employeeId: 'new01',
    name: 'New Employee',
    role: 'employee',
    businessId: 'business-a',
    email: employeeEmail,
    status: 'active',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  newEmployeeBatch.set(doc(owner, `users/${employeeUid}`), employeeRecord);
  newEmployeeBatch.set(doc(owner, `businesses/business-a/users/${employeeUid}`), employeeRecord);
  newEmployeeBatch.set(doc(owner, 'businesses/business-a/employeeIds/NEW01'), {
    employeeId: 'NEW01',
    employeeIdValue: 'new01',
    authUid: employeeUid,
    businessId: 'business-a',
    email: employeeEmail,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await assertSucceeds(newEmployeeBatch.commit(), 'Owner can create root and business employee profiles atomically');

  await Promise.all([
    assertFails(
      updateDoc(doc(otherOwner, 'users/employee-new'), { name: 'Unauthorized change' }),
      'Owner of another business cannot edit employee root profile',
    ),
    assertFails(
      updateDoc(doc(otherOwner, 'businesses/business-a/users/employee-new'), { name: 'Unauthorized change' }),
      'Owner of another business cannot edit employee membership',
    ),
    assertFails(
      updateDoc(doc(otherOwner, 'businesses/business-a/employeeIds/NEW01'), { status: 'inactive' }),
      'Owner of another business cannot change employee ID reservation',
    ),
  ]);

  const disableEmployeeBatch = writeBatch(owner);
  const disabledAt = new Date();
  disableEmployeeBatch.update(doc(owner, `users/${employeeUid}`), {
    status: 'inactive',
    active: false,
    updatedAt: disabledAt,
  });
  disableEmployeeBatch.update(doc(owner, `businesses/business-a/users/${employeeUid}`), {
    status: 'inactive',
    active: false,
    updatedAt: disabledAt,
  });
  disableEmployeeBatch.update(doc(owner, 'businesses/business-a/employeeIds/NEW01'), {
    status: 'inactive',
    updatedAt: disabledAt,
  });
  await assertSucceeds(disableEmployeeBatch.commit(), 'Owner can deactivate linked employee without deleting history');

  const employeeNameBatch = writeBatch(owner);
  employeeNameBatch.update(doc(owner, 'users/employee-a'), { name: 'Updated Employee A' });
  employeeNameBatch.update(doc(owner, 'businesses/business-a/users/employee-a'), { name: 'Updated Employee A' });
  await assertSucceeds(employeeNameBatch.commit(), 'Owner can edit employee name without changing auth UID or employee ID');
  await assertFails(
    updateDoc(doc(owner, 'businesses/business-a/users/employee-a'), { employeeId: 'CHANGED01' }),
    'Owner cannot change linked employee ID',
  );

  console.log('Firestore Rules tests passed: onboarding, owner isolation, employee isolation, and denied financial data.');
} finally {
  await testEnvironment.cleanup();
}
