import { useContext, createContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from '@firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@firebase/firestore';

import {
  auth,
  configuredBusinessId,
  db,
  firebaseConfig,
  firebaseConfigError,
  isFirebaseConfigured,
} from './firebase';
import {
  employeeInternalEmail,
  employeeIdKey,
  normalizeEmployeeAuthUid,
  normalizeEmployeeId,
  signInEmployee,
} from './firebase/employeeAuthService';

const defaultProfile = {
  businessName: 'Usaha Makanan & Minuman',
  ownerName: 'Pemilik',
  address: 'Jl. Mawar No. 12',
  phone: '08123456789',
};

const ownerNavItems = [
  { label: 'Dashboard', path: '/', icon: '🏠' },
  { label: 'Penjualan', path: '/sales', icon: '🧾' },
  { label: 'Belanja', path: '/purchases', icon: '🛒' },
  { label: 'Pengeluaran', path: '/expenses', icon: '💸' },
  { label: 'Menu', path: '/menus', icon: '🍽️' },
  { label: 'Laporan', path: '/reports', icon: '📊' },
  { label: 'Pegawai', path: '/employees', icon: '👥' },
  { label: 'Modal', path: '/capital', icon: '💰' },
  { label: 'Pengaturan', path: '/settings', icon: '⚙️' },
];

const employeeNavItems = [
  { label: 'Kasir', path: '/cashier', icon: '💰' },
  { label: 'Riwayat Penjualan', path: '/sales', icon: '🧾' },
  { label: 'Pengeluaran', path: '/expenses', icon: '💸' },
];

const getNavItemsForRole = (role) => (role === 'owner' ? ownerNavItems : employeeNavItems);

function money(value) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(number);
}

function formatDateValue(date) {
  if (!date) return '';
  const dt = new Date(date);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const next = new Date(date);
  next.setDate(next.getDate() + offset);
  return next;
}

function getStartOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEndOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function normalizeRecord(record) {
  return {
    ...record,
    qty: Number(record.qty ?? 0),
    total: Number(record.total ?? 0),
    sellingPrice: Number(record.sellingPrice ?? 0),
    hpp: Number(record.hpp ?? 0),
    amount: Number(record.amount ?? 0),
    cost: Number(record.cost ?? 0),
    purchasePrice: Number(record.purchasePrice ?? 0),
    quantity: Number(record.quantity ?? 0),
  };
}

function getPeriodRange(period, customStart, customEnd) {
  const endDate = customEnd ? new Date(customEnd) : new Date();
  const startDate = customStart ? new Date(customStart) : new Date();

  if (period === 'today') {
    return {
      start: getStartOfDay(new Date()),
      end: getEndOfDay(new Date()),
    };
  }

  if (period === 'week') {
    const start = addDays(new Date(), -6);
    return { start: getStartOfDay(start), end: getEndOfDay(new Date()) };
  }

  if (period === 'month') {
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    return { start: getStartOfDay(start), end: getEndOfDay(new Date()) };
  }

  if (period === 'custom') {
    return {
      start: getStartOfDay(startDate),
      end: getEndOfDay(endDate),
    };
  }

  return {
    start: getStartOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    end: getEndOfDay(new Date()),
  };
}

function filterByPeriod(records, period = 'month', customStart, customEnd) {
  const { start, end } = getPeriodRange(period, customStart, customEnd);
  return (records || []).filter((record) => {
    const value = record.date ? new Date(record.date) : null;
    if (!value || Number.isNaN(value.getTime())) return false;
    const dateInRange = value >= start && value <= end;
    return dateInRange;
  });
}

function calculateDashboardMetrics(data, period, customStart, customEnd) {
  const sales = filterByPeriod(data.sales, period, customStart, customEnd);
  const purchases = filterByPeriod(data.purchases, period, customStart, customEnd);
  const expenses = filterByPeriod(data.expenses, period, customStart, customEnd);
  const capital = data.capital || [];

  const totalRevenue = sales.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const totalPurchases = purchases.reduce((sum, row) => sum + Number(row.cost || 0), 0);
  const totalExpenses = expenses.reduce((sum, row) => sum + Number(row.total ?? row.amount ?? 0), 0);
  const totalHpp = sales.reduce((sum, row) => {
    const menu = (data.menus || []).find((item) => item.id === row.menuId);
    return sum + Number(row.hpp ?? Number(row.qty || 0) * Number(menu?.purchasePrice || 0));
  }, 0);
  const totalCapitalValue = capital.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const soldProducts = sales.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const totalTransactions = sales.length + purchases.length + expenses.length;

  const menuCounts = sales.reduce((acc, row) => {
    const name = row.menuName || 'Unknown';
    acc[name] = (acc[name] || 0) + Number(row.qty || 0);
    return acc;
  }, {});

  const bestSeller = Object.entries(menuCounts).sort((a, b) => b[1] - a[1])[0] || ['-', 0];

  const purchaseCategoryStats = purchases.reduce((acc, row) => {
    const category = row.category || 'Lainnya';
    acc[category] = (acc[category] || 0) + Number(row.cost || 0);
    return acc;
  }, {});
  const purchaseLargest = Object.entries(purchaseCategoryStats).sort((a, b) => b[1] - a[1])[0] || ['-', 0];

  const expenseCategoryStats = expenses.reduce((acc, row) => {
    const category = row.category || 'Lainnya';
    acc[category] = (acc[category] || 0) + Number(row.total ?? row.amount ?? 0);
    return acc;
  }, {});
  const expenseLargest = Object.entries(expenseCategoryStats).sort((a, b) => b[1] - a[1])[0] || ['-', 0];

  const estimatedProfit = totalRevenue - totalExpenses - totalHpp;
  const cashProjection = totalCapitalValue + totalRevenue - totalPurchases - totalExpenses;

  return {
    totalCapitalValue,
    totalRevenue,
    totalPurchases,
    totalExpenses,
    totalHpp,
    estimatedProfit,
    cashProjection,
    totalTransactions,
    soldProducts,
    bestSeller: { name: bestSeller[0], value: bestSeller[1] },
    purchaseLargest: { name: purchaseLargest[0], value: purchaseLargest[1] },
    expenseLargest: { name: expenseLargest[0], value: expenseLargest[1] },
  };
}

function generatePeriodSeries(data, period, customStart, customEnd) {
  const records = [
    ...filterByPeriod(data.sales, period, customStart, customEnd).map((item) => ({
      date: item.date,
      revenue: Number(item.total || 0),
      purchase: 0,
      expense: 0,
    })),
    ...filterByPeriod(data.purchases, period, customStart, customEnd).map((item) => ({
      date: item.date,
      revenue: 0,
      purchase: Number(item.cost || 0),
      expense: 0,
    })),
    ...filterByPeriod(data.expenses, period, customStart, customEnd).map((item) => ({
      date: item.date,
      revenue: 0,
      purchase: 0,
      expense: Number(item.total ?? item.amount ?? 0),
    })),
  ];

  const buckets = {};
  records.forEach((item) => {
    const key = item.date || 'unknown';
    if (!buckets[key]) {
      buckets[key] = { name: key, revenue: 0, purchase: 0, expense: 0 };
    }
    buckets[key].revenue += item.revenue;
    buckets[key].purchase += item.purchase;
    buckets[key].expense += item.expense;
  });

  return Object.values(buckets)
    .sort((a, b) => new Date(a.name) - new Date(b.name))
    .map((item) => ({ ...item, name: new Date(item.name).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' }) }));
}

const defaultSeedMenus = [
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

async function createOwnerBusiness(firebaseUser, ownerName = 'Pemilik') {
  if (!db || !firebaseUser?.uid) throw new Error('Sesi Firebase tidak tersedia.');
  const businessId = doc(collection(db, 'businesses')).id;
  const businessRef = doc(db, 'businesses', businessId);
  const memberRef = doc(db, 'businesses', businessId, 'users', firebaseUser.uid);
  const ownerProfileRef = doc(db, 'users', firebaseUser.uid);
  const profileRef = doc(db, 'businesses', businessId, 'settings', 'profile');
  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.set(ownerProfileRef, {
    uid: firebaseUser.uid,
    email: firebaseUser.email || '',
    name: ownerName,
    role: 'owner',
    businessId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  batch.set(businessRef, {
    id: businessId,
    ownerId: firebaseUser.uid,
    createdAt: now,
    updatedAt: now,
    seededMenusAt: now,
  });
  batch.set(memberRef, {
    uid: firebaseUser.uid,
    name: ownerName,
    email: firebaseUser.email || '',
    role: 'owner',
    status: 'active',
    active: true,
    businessId,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(profileRef, {
    businessName: ownerName === 'Pemilik' ? 'Usaha Makanan & Minuman' : ownerName,
    ownerName,
    currency: 'IDR',
    businessId,
    createdAt: now,
    updatedAt: now,
  });
  for (const [id, name, sellingPrice] of defaultSeedMenus) {
    batch.set(doc(db, 'businesses', businessId, 'menus', id), {
      id,
      name,
      category: 'Minuman',
      purchasePrice: 0,
      sellingPrice,
      status: 'aktif',
      createdBy: firebaseUser.uid,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(doc(db, 'businesses', businessId, 'cashierMenus', id), {
      id,
      name,
      category: 'Minuman',
      sellingPrice,
      status: 'aktif',
      createdAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();

  return {
    businessId,
    role: 'owner',
    profile: { uid: firebaseUser.uid, name: ownerName, email: firebaseUser.email || '', role: 'owner', businessId, status: 'active' },
  };
}

async function resolveOwnerSession(firebaseUser, ownerName = 'Pemilik') {
  if (!db || !firebaseUser?.uid) throw new Error('Sesi Firebase tidak tersedia.');
  const ownerProfileRef = doc(db, 'users', firebaseUser.uid);
  let ownerProfileSnapshot = await getDoc(ownerProfileRef);

  if (!ownerProfileSnapshot.exists()) {
    const possibleBusinessIds = [...new Set([configuredBusinessId, firebaseUser.uid].filter(Boolean))];
    let existingMembership = null;
    let legacyBusinessId = '';
    for (const possibleBusinessId of possibleBusinessIds) {
      const snapshot = await getDoc(
        doc(db, 'businesses', possibleBusinessId, 'users', firebaseUser.uid),
      );
      if (snapshot.exists()) {
        existingMembership = snapshot.data();
        legacyBusinessId = possibleBusinessId;
        break;
      }
    }
    if (existingMembership?.role === 'employee') {
      throw new Error('Akun ini sudah terhubung sebagai pegawai, bukan Owner.');
    }
    if (existingMembership?.role === 'owner'
      && existingMembership.active !== false
      && existingMembership.status !== 'inactive') {
      await setDoc(ownerProfileRef, {
        uid: firebaseUser.uid,
        email: firebaseUser.email || existingMembership.email || '',
        name: existingMembership.name || ownerName,
        role: 'owner',
        businessId: existingMembership.businessId || legacyBusinessId,
        status: 'active',
        createdAt: existingMembership.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ownerProfileSnapshot = await getDoc(ownerProfileRef);
    } else {
      const recovered = await createOwnerBusiness(firebaseUser, ownerName);
      return recovered;
    }
  }

  const ownerProfile = ownerProfileSnapshot.data();
  if (ownerProfile.uid !== firebaseUser.uid
    || ownerProfile.role !== 'owner'
    || ownerProfile.status !== 'active'
    || typeof ownerProfile.businessId !== 'string'
    || !ownerProfile.businessId) {
    throw new Error('Profil Owner belum selesai dibuat atau tidak aktif. Hubungi pemilik bisnis.');
  }

  const { businessId } = ownerProfile;
  const memberRef = doc(db, 'businesses', businessId, 'users', firebaseUser.uid);
  let memberSnapshot = await getDoc(memberRef);
  if (!memberSnapshot.exists()) {
    const now = serverTimestamp();
    await setDoc(memberRef, {
      uid: firebaseUser.uid,
      name: ownerProfile.name || ownerName,
      email: firebaseUser.email || ownerProfile.email || '',
      role: 'owner',
      status: 'active',
      active: true,
      businessId,
      createdAt: now,
      updatedAt: now,
    });
    memberSnapshot = await getDoc(memberRef);
  }
  const memberProfile = memberSnapshot.data();
  if (memberProfile.role !== 'owner'
    || memberProfile.status === 'inactive'
    || memberProfile.active === false
    || memberProfile.businessId !== businessId) {
    throw new Error('Akun ini tidak memiliki akses Owner aktif pada bisnis tersebut.');
  }

  const businessRef = doc(db, 'businesses', businessId);
  let businessSnapshot = await getDoc(businessRef);
  if (!businessSnapshot.exists()) {
    await setDoc(businessRef, {
      id: businessId,
      ownerId: firebaseUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    businessSnapshot = await getDoc(businessRef);
  }

  const profileRef = doc(db, 'businesses', businessId, 'settings', 'profile');
  const profileSnapshot = await getDoc(profileRef);
  if (!profileSnapshot.exists()) {
    await setDoc(profileRef, {
      businessName: ownerProfile.name || 'Usaha Makanan & Minuman',
      ownerName: ownerProfile.name || ownerName,
      currency: 'IDR',
      businessId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  if (!businessSnapshot.data()?.seededMenusAt) {
    const [menusSnapshot, cashierMenusSnapshot] = await Promise.all([
      getDocs(collection(db, 'businesses', businessId, 'menus')),
      getDocs(collection(db, 'businesses', businessId, 'cashierMenus')),
    ]);
    const existingMenus = new Map(menusSnapshot.docs.map((menu) => [menu.id, menu.data()]));
    const existingCashierMenus = new Set(cashierMenusSnapshot.docs.map((menu) => menu.id));
    const batch = writeBatch(db);
    const now = serverTimestamp();
    for (const [id, name, sellingPrice] of defaultSeedMenus) {
      const existingMenu = existingMenus.get(id);
      const menu = existingMenu || {
        id,
        name,
        category: 'Minuman',
        purchasePrice: 0,
        sellingPrice,
        status: 'aktif',
        createdBy: firebaseUser.uid,
        createdAt: now,
        updatedAt: now,
      };
      if (!existingMenu) {
        batch.set(doc(db, 'businesses', businessId, 'menus', id), menu);
      }
      if (!existingCashierMenus.has(id)) {
        batch.set(doc(db, 'businesses', businessId, 'cashierMenus', id), {
          id,
          name: menu.name,
          category: menu.category || 'Minuman',
          sellingPrice: Number(menu.sellingPrice ?? sellingPrice),
          status: menu.status || 'aktif',
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    batch.set(businessRef, { seededMenusAt: now, updatedAt: now }, { merge: true });
    await batch.commit();
  }

  return { businessId, role: 'owner', profile: { ...ownerProfile, ...memberProfile } };
}

const AuthContext = createContext({
  user: null,
  role: null,
  businessId: '',
  memberProfile: null,
  loading: true,
  authError: '',
  firebaseConfigError: '',
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  resetPassword: async () => {},
  authConfigured: false,
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [memberProfile, setMemberProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const resolvedAuthUidRef = useRef('');

  useEffect(() => {
    if (!auth || !db) {
      setUser(null);
      setRole(null);
      setBusinessId('');
      setMemberProfile(null);
      setLoading(false);
      return;
    }

    let unsubscribeMember = null;
    let authEventId = 0;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const eventId = ++authEventId;
      setLoading(true);
      if (unsubscribeMember) {
        unsubscribeMember();
        unsubscribeMember = null;
      }
      if (!currentUser) {
        resolvedAuthUidRef.current = '';
        setUser(null);
        setRole(null);
        setBusinessId('');
        setMemberProfile(null);
        setAuthError('');
        setLoading(false);
        return;
      }

      try {
        const ownerProfileSnapshot = await getDoc(doc(db, 'users', currentUser.uid));
        let resolvedBusinessId = '';
        let resolvedRole = '';
        let resolvedProfile = null;

        if (ownerProfileSnapshot.exists()) {
          const ownerProfile = ownerProfileSnapshot.data();
          if (ownerProfile.uid !== currentUser.uid) {
            throw new Error('Profil pengguna tidak cocok dengan akun Firebase yang sedang login.');
          }
          if (ownerProfile.status !== 'active') {
            throw new Error(ownerProfile.role === 'employee'
              ? 'Akun pegawai sudah dinonaktifkan. Hubungi Owner.'
              : 'Profil Owner belum selesai dibuat atau tidak aktif.');
          }
          if (ownerProfile.role === 'owner') {
            const ownerSession = await resolveOwnerSession(currentUser, ownerProfile.name || 'Pemilik');
            resolvedBusinessId = ownerSession.businessId;
            resolvedRole = 'owner';
            resolvedProfile = ownerSession.profile;
          } else if (ownerProfile.role === 'employee') {
            if (!ownerProfile.businessId) {
              throw new Error('Profil pegawai belum memiliki businessId. Hubungi Owner.');
            }
            const employeeSnapshot = await getDoc(
              doc(db, 'businesses', ownerProfile.businessId, 'users', currentUser.uid),
            );
            const membership = employeeSnapshot.exists() ? employeeSnapshot.data() : null;
            if (membership
              && membership.role === 'employee'
              && membership.status === 'active'
              && membership.active !== false
              && membership.businessId === ownerProfile.businessId
              && membership.employeeId === ownerProfile.employeeId
              && membership.uid === currentUser.uid
              && membership.authUid === currentUser.uid
              && currentUser.email?.toLowerCase() === ownerProfile.email?.toLowerCase()) {
              resolvedBusinessId = ownerProfile.businessId;
              resolvedRole = 'pegawai';
              resolvedProfile = membership;
            } else {
              throw new Error('Profil pegawai belum ditemukan atau tidak aktif. Hubungi Owner.');
            }
          } else {
            throw new Error('Profil pengguna tidak memiliki peran yang valid.');
          }
        } else {
          const legacyMembershipSnapshot = await getDoc(
            doc(db, 'businesses', currentUser.uid, 'users', currentUser.uid),
          );
          if (legacyMembershipSnapshot.exists()
            && legacyMembershipSnapshot.data().role === 'owner'
            && legacyMembershipSnapshot.data().active !== false
            && legacyMembershipSnapshot.data().status !== 'inactive') {
            const recoveredOwner = await resolveOwnerSession(currentUser);
            resolvedBusinessId = recoveredOwner.businessId;
            resolvedRole = 'owner';
            resolvedProfile = recoveredOwner.profile;
          }
        }

        if (!resolvedRole) {
          throw new Error('Profil pengguna belum ditemukan atau onboarding belum selesai. Masuk kembali atau hubungi Owner.');
        }
        if (eventId !== authEventId) return;
        resolvedAuthUidRef.current = currentUser.uid;
        setAuthError('');
        setUser(currentUser);
        setRole(resolvedRole);
        setBusinessId(resolvedBusinessId);
        setMemberProfile(resolvedProfile);
        unsubscribeMember = onSnapshot(
          doc(db, 'businesses', resolvedBusinessId, 'users', currentUser.uid),
          async (membershipUpdate) => {
            const updatedMember = membershipUpdate.exists() ? membershipUpdate.data() : null;
            if (!updatedMember || updatedMember.active === false || updatedMember.status === 'inactive') {
              await signOut(auth);
              return;
            }
            setRole(updatedMember.role === 'employee' ? 'pegawai' : updatedMember.role);
            setMemberProfile((profile) => ({ ...profile, ...updatedMember }));
          },
          (error) => {
            console.error('Gagal memantau status akses pengguna:', error);
            setAuthError('Gagal memeriksa status akses. Periksa koneksi dan Firestore Rules.');
          },
        );
      } catch (error) {
        if (eventId !== authEventId) return;
        if (resolvedAuthUidRef.current === currentUser.uid) return;
        console.error('Gagal memuat profil akses Firebase:', error);
        setUser(null);
        setRole(null);
        setBusinessId('');
        setMemberProfile(null);
        setAuthError(error.code === 'permission-denied'
          ? 'Akses Firestore ditolak saat memuat profil. Pastikan Rules terbaru telah diterapkan dan profil Owner serta membership tersedia.'
          : error.message || 'Gagal memuat profil pengguna.');
      } finally {
        if (eventId === authEventId) setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubscribeMember) unsubscribeMember();
    };
  }, []);

  const login = async ({ identifier, password, loginRole }) => {
    if (!auth || !db) {
      throw new Error('Firebase belum dikonfigurasi. Isi environment variables lalu mulai ulang aplikasi.');
    }

    setAuthError('');
    const result = loginRole === 'pegawai'
      ? await signInEmployee(auth, identifier, password)
      : await signInWithEmailAndPassword(auth, identifier.trim(), password);
    let resolved;
    if (loginRole === 'owner') {
      resolved = await resolveOwnerSession(result.user);
    } else {
      const profileSnapshot = await getDoc(doc(db, 'users', result.user.uid));
      const employeeProfile = profileSnapshot.exists() ? profileSnapshot.data() : null;
      if (!employeeProfile
        || employeeProfile.uid !== result.user.uid
        || employeeProfile.role !== 'employee'
        || employeeProfile.status !== 'active'
        || !employeeProfile.businessId) {
        await signOut(auth);
        throw new Error('Profil pegawai belum terhubung atau sudah dinonaktifkan. Hubungi Owner.');
      }
      const membershipSnapshot = await getDoc(
        doc(db, 'businesses', employeeProfile.businessId, 'users', result.user.uid),
      );
      const membership = membershipSnapshot.exists() ? membershipSnapshot.data() : null;
      if (!membership
        || membership.role !== 'employee'
        || membership.status !== 'active'
        || membership.active === false
        || membership.uid !== result.user.uid
        || membership.authUid !== result.user.uid
        || membership.businessId !== employeeProfile.businessId
        || membership.employeeId !== employeeProfile.employeeId
        || employeeProfile.email?.toLowerCase() !== employeeInternalEmail(identifier).toLowerCase()
        || membership.employeeId?.toLowerCase() !== identifier.trim().toLowerCase()
        || result.user.email?.toLowerCase() !== employeeInternalEmail(identifier).toLowerCase()) {
        await signOut(auth);
        throw new Error('Akun pegawai tidak terdaftar atau dinonaktifkan.');
      }
      resolved = { businessId: employeeProfile.businessId, role: 'pegawai', profile: membership };
    }

    setAuthError('');
    setUser(result.user);
    resolvedAuthUidRef.current = result.user.uid;
    setRole(resolved.role);
    setBusinessId(resolved.businessId);
    setMemberProfile(resolved.profile);
    return result.user;
  };

  const register = async ({ email, password, name }) => {
    if (!auth || !db) {
      throw new Error('Firebase belum dikonfigurasi. Isi environment variables lalu mulai ulang aplikasi.');
    }
    const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const resolved = await createOwnerBusiness(result.user, name.trim() || 'Pemilik');
    setAuthError('');
    setUser(result.user);
    resolvedAuthUidRef.current = result.user.uid;
    setRole('owner');
    setBusinessId(resolved.businessId);
    setMemberProfile(resolved.profile);
    return result.user;
  };

  const logout = async () => {
    if (!auth) {
      setUser(null);
      setRole(null);
      setBusinessId('');
      setMemberProfile(null);
      return;
    }
    await signOut(auth);
  };

  const resetPassword = async (email) => {
    if (!auth) {
      return;
    }
    return sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        businessId,
        memberProfile,
        loading,
        authError,
        firebaseConfigError,
        login,
        register,
        logout,
        resetPassword,
        authConfigured: isFirebaseConfigured,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}

function App() {
  const {
    user,
    role,
    businessId,
    memberProfile,
    loading,
    logout,
    authConfigured,
    firebaseConfigError: firebaseInitializationError,
  } = useAuth();
  const userRole = role;
  const [data, setData] = useState({
    profile: defaultProfile,
    menus: [],
    sales: [],
    purchases: [],
    expenses: [],
    capital: [],
    shifts: [],
  });
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [period, setPeriod] = useState('month');
  const [customStart, setCustomStart] = useState(formatDateValue(addDays(new Date(), -6)));
  const [customEnd, setCustomEnd] = useState(formatDateValue(new Date()));

  useEffect(() => {
    if (!authConfigured || !user || !businessId || !['owner', 'pegawai'].includes(userRole)) {
      setDataLoading(false);
      return;
    }

    const basePath = ['businesses', businessId];
    const subscriptions = [];
    const watched = userRole === 'owner'
      ? ['menus', 'sales', 'purchases', 'expenses', 'capital', 'shifts', 'salesPrivate', 'users']
      : ['cashierMenus', 'sales', 'expenses', 'shifts'];
    const privateSalesHpp = new Map();
    const initialState = {
      profile: userRole === 'owner' ? defaultProfile : {},
      menus: [],
      sales: [],
      purchases: [],
      expenses: [],
      capital: [],
      shifts: [],
      users: [],
    };
    let pending = watched.length + (userRole === 'owner' ? 1 : 0);
    setData(initialState);
    setDataLoading(true);
    setDataError('');

    const makeQuery = (name) => {
      const collectionRef = collection(db, ...basePath, name);
      if (userRole === 'pegawai' && (name === 'sales' || name === 'expenses')) {
        return query(collectionRef, where('createdBy', '==', user.uid));
      }
      if (userRole === 'pegawai' && name === 'cashierMenus') {
        return query(collectionRef, where('status', '==', 'aktif'));
      }
      if (userRole === 'pegawai' && name === 'shifts') {
        return query(collectionRef, where('employeeId', '==', user.uid));
      }
      return collectionRef;
    };

    const finishInitialLoad = () => {
      pending -= 1;
      if (pending <= 0) setDataLoading(false);
    };

    const handleError = (error) => {
      console.error('Firestore subscription failed:', error);
      setDataError('Gagal memuat data. Periksa koneksi dan izin Firebase.');
      finishInitialLoad();
    };

    watched.forEach((name) => {
      subscriptions.push(onSnapshot(makeQuery(name), (snapshot) => {
        const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        setData((current) => {
          if (name === 'cashierMenus') return { ...current, menus: records };
          if (name === 'salesPrivate') {
            records.forEach((record) => privateSalesHpp.set(record.id, Number(record.hpp || 0)));
            return {
              ...current,
              sales: current.sales.map((sale) => ({
                ...sale,
                hpp: privateSalesHpp.get(sale.id)
                  ?? Number(current.menus.find((menu) => menu.id === sale.menuId)?.purchasePrice || 0) * Number(sale.qty || 0),
              })),
            };
          }
          if (name === 'menus') {
            return {
              ...current,
              menus: records,
              sales: current.sales.map((sale) => ({
                ...sale,
                hpp: privateSalesHpp.get(sale.id)
                  ?? Number(records.find((menu) => menu.id === sale.menuId)?.purchasePrice || 0) * Number(sale.qty || 0),
              })),
            };
          }
          const visibleRecords = name === 'sales'
            ? records.map((sale) => ({
              ...sale,
              hpp: privateSalesHpp.get(sale.id)
                ?? Number(current.menus.find((menu) => menu.id === sale.menuId)?.purchasePrice || 0) * Number(sale.qty || 0),
            }))
            : records;
          return { ...current, [name]: visibleRecords };
        });
        finishInitialLoad();
      }, handleError));
    });

    if (userRole === 'owner') {
      subscriptions.push(onSnapshot(
        doc(db, ...basePath, 'settings', 'profile'),
        (snapshot) => {
          setData((current) => ({
            ...current,
            profile: { ...defaultProfile, ...(snapshot.exists() ? snapshot.data() : {}) },
          }));
          finishInitialLoad();
        },
        handleError,
      ));
    }

    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [authConfigured, user, businessId, userRole]);

  const metrics = useMemo(
    () => calculateDashboardMetrics(data, period, customStart, customEnd),
    [data, period, customStart, customEnd],
  );

  const periodSeries = useMemo(
    () => generatePeriodSeries(data, period, customStart, customEnd),
    [data, period, customStart, customEnd],
  );

  const enrichSales = (sales) =>
    sales.map((item) => {
      const menu = (data.menus || []).find((entry) => entry.id === item.menuId);
      return {
        ...item,
        menuName: item.menuName || menu?.name || 'Menu',
        hpp: Number(item.hpp || (item.qty || 0) * (menu?.purchasePrice || 0)),
        total: Number(item.total || (item.qty || 0) * (item.sellingPrice || 0)),
      };
    });

  const writeRecord = async (collectionName, record, recordId = crypto.randomUUID()) => {
    if (!db || !user || !businessId) throw new Error('Sesi Firebase tidak tersedia.');
    const ref = doc(db, 'businesses', businessId, collectionName, recordId);
    try {
      await setDoc(ref, {
        ...record,
        id: recordId,
        businessId,
        createdBy: user.uid,
        userId: user.uid,
        createdAt: record.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error(`Failed writing Firestore ${collectionName}:`, error);
      setDataError('Gagal menyimpan data. Silakan coba lagi.');
      throw new Error('Gagal menyimpan data. Silakan coba lagi.');
    }
    return recordId;
  };

  const deleteRecord = async (collectionName, recordId) => {
    if (!db || !businessId) throw new Error('Sesi Firebase tidak tersedia.');
    try {
      await deleteDoc(doc(db, 'businesses', businessId, collectionName, recordId));
    } catch (error) {
      console.error(`Failed deleting Firestore ${collectionName}:`, error);
      setDataError('Gagal menghapus data. Silakan coba lagi.');
      throw new Error('Gagal menghapus data. Silakan coba lagi.');
    }
  };

  const addMenu = async (menu) => {
    const id = menu.id || crypto.randomUUID();
    const record = {
      ...menu,
      id,
      purchasePrice: Number(menu.purchasePrice || 0),
      sellingPrice: Number(menu.sellingPrice || 0),
      status: menu.status || 'aktif',
      createdBy: user.uid,
    };
    await writeRecord('menus', record, id);
    try {
      await setDoc(doc(db, 'businesses', businessId, 'cashierMenus', id), {
        id,
        name: record.name,
        category: record.category,
        sellingPrice: record.sellingPrice,
        status: record.status,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Failed publishing employee menu:', error);
      setDataError('Gagal memperbarui menu pegawai. Silakan coba lagi.');
      throw new Error('Gagal memperbarui menu pegawai. Silakan coba lagi.');
    }
  };

  const deleteMenu = async (menuId) => {
    await deleteRecord('menus', menuId);
    await deleteDoc(doc(db, 'businesses', businessId, 'cashierMenus', menuId));
  };

  const addSale = async (sale) => {
    const menu = (data.menus || []).find((item) => item.id === sale.menuId);
    const cashierMenu = (data.menus || []).find((item) => item.id === sale.menuId);
    const saleHpp = Number(sale.hpp ?? Number(sale.qty || 0) * Number(menu?.purchasePrice || 0));
    const { hpp: _privateHpp, ...publicSale } = sale;
    const normalized = {
      ...publicSale,
      menuName: menu?.name || cashierMenu?.name || sale.menuName || 'Menu',
      sellingPrice: Number(sale.sellingPrice ?? menu?.sellingPrice ?? 0),
      qty: Number(sale.qty || 0),
      total: Number(sale.total || Number(sale.qty || 0) * Number(sale.sellingPrice || menu?.sellingPrice || 0)),
      businessId,
      employeeId: user.uid,
      shiftId: sale.shiftId || '',
    };
    const id = await writeRecord('sales', normalized);
    if (userRole === 'owner') {
      await setDoc(doc(db, 'businesses', businessId, 'salesPrivate', id), {
        id,
        businessId,
        hpp: saleHpp,
        createdAt: serverTimestamp(),
      });
    }
  };

  const deleteSale = async (saleId) => {
    await deleteRecord('sales', saleId);
    if (userRole === 'owner') {
      await deleteDoc(doc(db, 'businesses', businessId, 'salesPrivate', saleId));
    }
  };

  const addPurchase = async (purchase) => {
    const normalized = normalizeRecord({
      ...purchase,
      date: purchase.date || formatDateValue(new Date()),
      quantity: Number(purchase.quantity || 0),
      cost: Number(purchase.cost || 0),
    });
    await writeRecord('purchases', normalized);
  };

  const deletePurchase = (id) => deleteRecord('purchases', id);

  const addExpense = async (expense) => {
    const itemName = expense.itemName || expense.title || 'Item';
    const quantity = Number(expense.quantity || 0);
    const unitPrice = Number(expense.unitPrice || expense.amount || 0);
    const total = quantity * unitPrice;
    await writeRecord('expenses', {
      ...expense,
      itemName,
      title: itemName,
      date: expense.date || formatDateValue(new Date()),
      quantity,
      unitPrice,
      total,
      amount: total,
      notes: expense.notes || '',
      businessId,
      createdBy: user.uid,
      userId: user.uid,
    });
  };

  const deleteExpense = (id) => deleteRecord('expenses', id);

  const addCapital = async (capital) => {
    const normalized = normalizeRecord({
      ...capital,
      date: capital.date || formatDateValue(new Date()),
      amount: Number(capital.amount || 0),
    });
    await writeRecord('capital', normalized);
  };

  const deleteCapital = (id) => deleteRecord('capital', id);

  const saveProfile = async (profile) => {
    if (!db || !user || !businessId) throw new Error('Sesi Firebase tidak tersedia.');
    await setDoc(doc(db, 'businesses', businessId, 'settings', 'profile'), {
      ...data.profile,
      ...profile,
      businessId,
      updatedAt: serverTimestamp(),
    });
  };

  const saveEmployee = async ({ employeeId, name, authUid }) => {
    if (!db || userRole !== 'owner' || !businessId || !user) {
      throw new Error('Hanya Owner aktif yang dapat menambahkan pegawai.');
    }
    const normalizedEmployeeId = normalizeEmployeeId(employeeId);
    const normalizedName = name.trim();
    const normalizedAuthUid = normalizeEmployeeAuthUid(authUid);
    if (!normalizedName || normalizedName.length > 100) {
      throw new Error('Nama Pegawai wajib diisi, maksimal 100 karakter.');
    }
    const email = employeeInternalEmail(normalizedEmployeeId);
    const employeeCollection = collection(db, 'businesses', businessId, 'users');
    const employeeRef = doc(db, 'businesses', businessId, 'users', normalizedAuthUid);
    const rootEmployeeRef = doc(db, 'users', normalizedAuthUid);
    const reservationKey = employeeIdKey(normalizedEmployeeId);
    const idReservationRef = doc(db, 'businesses', businessId, 'employeeIds', reservationKey);
    const [matchingEmployees, matchingEmails] = await Promise.all([
      getDocs(query(employeeCollection, where('employeeId', '==', normalizedEmployeeId))),
      getDocs(query(employeeCollection, where('email', '==', email))),
    ]);
    const linkedWithId = matchingEmployees.docs.find((snapshot) => snapshot.id !== normalizedAuthUid);
    if (linkedWithId) throw new Error('ID Pegawai sudah terdaftar.');
    const linkedWithEmail = matchingEmails.docs.find((snapshot) => snapshot.id !== normalizedAuthUid);
    if (linkedWithEmail
      || data.users.some((person) => {
        if (person.id === normalizedAuthUid
          || (person.role !== 'employee' && person.role !== 'pegawai')) return false;
        try {
          return employeeInternalEmail(person.employeeId) === email;
        } catch {
          return false;
        }
      })) {
      throw new Error('Email internal ini sudah digunakan oleh pegawai lain. Gunakan ID Pegawai yang berbeda.');
    }

    try {
      await runTransaction(db, async (transaction) => {
        const [memberSnapshot, reservationSnapshot, rootSnapshot] = await Promise.all([
          transaction.get(employeeRef),
          transaction.get(idReservationRef),
          transaction.get(rootEmployeeRef),
        ]);
        const currentMember = memberSnapshot.exists() ? memberSnapshot.data() : null;
        const currentReservation = reservationSnapshot.exists() ? reservationSnapshot.data() : null;
        const currentRootProfile = rootSnapshot.exists()
          ? rootSnapshot.data()
          : null;

        if (currentMember?.role === 'owner' || currentRootProfile?.role === 'owner') {
          throw new Error('UID ini adalah akun Owner dan tidak dapat digunakan sebagai pegawai.');
        }
        if (currentRootProfile
          && (currentRootProfile.role !== 'employee'
            || currentRootProfile.businessId !== businessId
            || employeeIdKey(currentRootProfile.employeeId) !== reservationKey)) {
          throw new Error('Akun Firebase ini sudah terhubung dengan pegawai lain.');
        }
        if (currentMember
          && (currentMember.role !== 'employee'
            || currentMember.businessId !== businessId
            || employeeIdKey(currentMember.employeeId) !== reservationKey)) {
          throw new Error('Akun Firebase ini sudah terhubung dengan pegawai lain.');
        }
        if (currentReservation && currentReservation.authUid !== normalizedAuthUid) {
          throw new Error('ID Pegawai sudah terdaftar.');
        }

        const savedEmployeeId = currentReservation?.employeeIdValue
          || currentMember?.employeeId
          || currentRootProfile?.employeeId
          || normalizedEmployeeId;
        const savedEmail = employeeInternalEmail(savedEmployeeId);
        if ((currentMember && currentMember.email !== savedEmail)
          || (currentRootProfile && currentRootProfile.email !== savedEmail)) {
          throw new Error('ID Pegawai tidak cocok dengan email internal akun Firebase yang sudah terhubung.');
        }
        const status = currentMember?.status || 'active';
        const createdAt = currentMember?.createdAt || serverTimestamp();
        const profile = {
          uid: normalizedAuthUid,
          authUid: normalizedAuthUid,
          employeeId: savedEmployeeId,
          name: normalizedName,
          role: 'employee',
          businessId,
          status,
          active: status === 'active',
          email,
          createdAt,
          updatedAt: serverTimestamp(),
        };

        transaction.set(rootEmployeeRef, profile, { merge: true });
        transaction.set(employeeRef, profile, { merge: true });
        transaction.set(idReservationRef, {
          employeeId: reservationKey,
          employeeIdValue: savedEmployeeId,
          authUid: normalizedAuthUid,
          businessId,
          email,
          status,
          updatedAt: serverTimestamp(),
          ...(currentReservation ? {} : { createdAt: serverTimestamp() }),
        }, { merge: true });
      });
    } catch (error) {
      if (error.code === 'permission-denied' || error.message === 'Missing or insufficient permissions.') {
        throw new Error('Akun Firebase ini sudah terhubung dengan pengguna lain atau UID tidak cocok dengan akun pegawai. Periksa UID dan email akun di Firebase Console.');
      }
      throw error;
    }
  };

  const updateEmployeeProfile = async (employee, name) => {
    if (!db || userRole !== 'owner' || !businessId || !user) {
      throw new Error('Hanya Owner aktif yang dapat mengubah profil pegawai.');
    }
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 100) {
      throw new Error('Nama Pegawai wajib diisi, maksimal 100 karakter.');
    }
    const employeeUid = normalizeEmployeeAuthUid(employee.authUid || employee.id);
    const updates = { name: normalizedName, updatedAt: serverTimestamp() };
    const batch = writeBatch(db);
    batch.update(doc(db, 'businesses', businessId, 'users', employeeUid), updates);
    batch.set(doc(db, 'users', employeeUid), updates, { merge: true });
    await batch.commit();
  };

  const updateEmployeeStatus = async (employee, active) => {
    if (!db || userRole !== 'owner' || !businessId) {
      throw new Error('Hanya Owner aktif yang dapat mengubah status pegawai.');
    }
    const employeeUid = normalizeEmployeeAuthUid(employee.authUid || employee.id);
    const updates = {
      status: active ? 'active' : 'inactive',
      active,
      updatedAt: serverTimestamp(),
    };
    const batch = writeBatch(db);
    batch.update(doc(db, 'businesses', businessId, 'users', employeeUid), updates);
    batch.set(doc(db, 'users', employeeUid), updates, { merge: true });
    batch.set(doc(db, 'businesses', businessId, 'employeeIds', employee.employeeId), updates, { merge: true });
    await batch.commit();
  };

  const exportBackup = () => {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `catatan-usaha-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const names = ['menus', 'sales', 'purchases', 'expenses', 'capital'];
      if (!parsed || names.some((name) => parsed[name] !== undefined && !Array.isArray(parsed[name]))) {
        throw new Error('File backup tidak valid.');
      }
      if (!window.confirm('Data backup akan ditambahkan atau diperbarui; data lama yang tidak ada di backup tidak akan dihapus. Lanjutkan?')) {
        return;
      }

      if (parsed.profile) await saveProfile(parsed.profile);
      for (const name of names) {
        for (const record of parsed[name] || []) {
          if (!record || typeof record !== 'object' || !record.id) continue;
          const { id, ...payload } = record;
          if (name === 'menus') {
            const menu = {
              ...payload,
              purchasePrice: Number(payload.purchasePrice || 0),
              sellingPrice: Number(payload.sellingPrice || 0),
            };
            await writeRecord(name, menu, id);
            await setDoc(doc(db, 'businesses', businessId, 'cashierMenus', id), {
              id,
              name: menu.name,
              category: menu.category,
              sellingPrice: menu.sellingPrice,
              status: menu.status || 'aktif',
              updatedAt: serverTimestamp(),
            });
          } else if (name === 'sales') {
            const { hpp, ...publicSale } = payload;
            await writeRecord(name, publicSale, id);
            if (hpp !== undefined) {
              await setDoc(doc(db, 'businesses', businessId, 'salesPrivate', id), {
                id,
                businessId,
                hpp: Number(hpp || 0),
                createdAt: serverTimestamp(),
              });
            }
          } else {
            await writeRecord(name, payload, id);
          }
        }
      }
    } catch (error) {
      console.error('Backup import failed:', error);
      window.alert(error.message === 'File backup tidak valid.' ? error.message : 'Gagal mengimpor backup. Periksa format file dan koneksi.');
    } finally {
      event.target.value = '';
    }
  };

  const dashboardPageProps = {
    data,
    metrics,
    periodSeries,
    period,
    setPeriod,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    enrichSales,
  };

  const authBlock = !authConfigured ? (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      {firebaseInitializationError || 'Firebase belum dikonfigurasi. Isi nilai pada file .env lalu mulai ulang aplikasi.'}
    </div>
  ) : dataError ? (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{dataError}</div>
  ) : null;

  return (
    <div className="min-h-screen bg-slate-100">
      {loading ? (
        <div className="flex min-h-screen items-center justify-center">Memuat profil...</div>
      ) : user && (!['owner', 'pegawai'].includes(userRole) || !businessId) ? (
        <div className="flex min-h-screen items-center justify-center px-4">
          <section className="card w-full max-w-md p-6 text-center">
            <h1 className="text-lg font-bold text-slate-900">
              {!userRole || !['owner', 'pegawai'].includes(userRole)
                ? 'Role pengguna tidak valid.'
                : 'Profil pengguna belum memiliki businessId.'}
            </h1>
            <p className="mt-2 text-sm text-slate-600">Keluar lalu masuk kembali, atau hubungi Owner untuk memeriksa profil.</p>
            <button className="btn-primary mt-5" onClick={logout}>Keluar</button>
          </section>
        </div>
      ) : (
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route
            path="*"
            element={
              <ProtectedLayout
                user={user}
                role={userRole}
                businessId={businessId}
                memberProfile={memberProfile}
                data={data}
                dataLoading={dataLoading}
                logout={logout}
                dashboardPageProps={dashboardPageProps}
                addMenu={addMenu}
                deleteMenu={deleteMenu}
                addSale={addSale}
                deleteSale={deleteSale}
                addPurchase={addPurchase}
                deletePurchase={deletePurchase}
                addExpense={addExpense}
                deleteExpense={deleteExpense}
                addCapital={addCapital}
                deleteCapital={deleteCapital}
                addEmployee={saveEmployee}
                updateEmployeeProfile={updateEmployeeProfile}
                updateEmployeeStatus={updateEmployeeStatus}
                saveProfile={saveProfile}
                exportBackup={exportBackup}
                importBackup={importBackup}
                period={period}
                setPeriod={setPeriod}
                customStart={customStart}
                setCustomStart={setCustomStart}
                customEnd={customEnd}
                setCustomEnd={setCustomEnd}
                data={data}
                metrics={metrics}
                periodSeries={periodSeries}
                enrichSales={enrichSales}
                authBlock={authBlock}
              />
            }
          />
        </Routes>
      )}
    </div>
  );
}

function ProtectedLayout({
  user,
  role,
  businessId,
  memberProfile,
  logout,
  addMenu,
  deleteMenu,
  addSale,
  deleteSale,
  addPurchase,
  deletePurchase,
  addExpense,
  deleteExpense,
  addCapital,
  deleteCapital,
  addEmployee,
  updateEmployeeProfile,
  updateEmployeeStatus,
  saveProfile,
  exportBackup,
  importBackup,
  period,
  setPeriod,
  customStart,
  setCustomStart,
  customEnd,
  setCustomEnd,
  data,
  dataLoading,
  metrics,
  periodSeries,
  enrichSales,
  authBlock,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthenticated = Boolean(user);
  const activeRole = role;
  const visibleNavItems = getNavItemsForRole(activeRole);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (!['owner', 'pegawai'].includes(role) || !businessId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <section className="card w-full max-w-md p-6 text-center">
          <h1 className="text-lg font-bold text-slate-900">
            {!role || !['owner', 'pegawai'].includes(role)
              ? 'Role pengguna tidak valid.'
              : 'Profil pengguna belum memiliki businessId.'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">Keluar lalu masuk kembali, atau hubungi Owner untuk memeriksa profil.</p>
          <button className="btn-primary mt-5" onClick={async () => {
            await logout();
            navigate('/login');
          }}>
            Keluar
          </button>
        </section>
      </main>
    );
  }

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex max-w-7xl gap-4 px-4 py-4 lg:gap-6 lg:px-6">
        <aside className="hidden w-72 shrink-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-soft lg:block">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white">C</div>
            <div>
              <div className="text-lg font-bold">Catatan Usaha</div>
              <div className="text-xs text-slate-500">{data.profile?.businessName || 'Usaha'}</div>
            </div>
          </div>

          <nav className="space-y-1">
            {visibleNavItems.map((item) => (
              <NavLink key={item.path} to={item.path} className="nav-link" end={item.path === '/'}>
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="mt-8 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-800">Akun</div>
            <div className="mt-2">
              {activeRole === 'pegawai'
                ? memberProfile?.employeeId || memberProfile?.name
                : memberProfile?.name || user?.email}
            </div>
            <div className="mt-1 capitalize">{activeRole}</div>
            <button className="btn-secondary mt-3 w-full" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </aside>

        <main className="flex-1 pb-24 lg:pb-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft lg:p-6">
            <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Dashboard Bisnis</p>
                <h1 className="page-title mt-1">{visibleNavItems.find((item) => item.path === location.pathname)?.label || 'Dashboard'}</h1>
              </div>

              {activeRole === 'owner' && (
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input max-w-[180px]" value={period} onChange={(e) => setPeriod(e.target.value)}>
                    <option value="today">Hari ini</option>
                    <option value="week">7 hari</option>
                    <option value="month">Bulan ini</option>
                    <option value="custom">Custom</option>
                  </select>

                  {period === 'custom' && (
                    <>
                      <input
                        type="date"
                        className="input max-w-[150px]"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                      />
                      <input
                        type="date"
                        className="input max-w-[150px]"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                      />
                    </>
                  )}
                </div>
              )}
            </div>

            {authBlock}

            {dataLoading ? (
              <div className="rounded-2xl bg-slate-50 p-8 text-center text-slate-600">Memuat data...</div>
            ) : (
              <Routes>
                {activeRole === 'owner' ? (
                  <>
                  <Route
                    path="/"
                    element={<DashboardPage data={data} metrics={metrics} periodSeries={periodSeries} period={period} setPeriod={setPeriod} customStart={customStart} setCustomStart={setCustomStart} customEnd={customEnd} setCustomEnd={setCustomEnd} enrichSales={enrichSales} />}
                  />
                  <Route path="/sales" element={<SalesPage data={data} addSale={addSale} deleteSale={deleteSale} />} />
                  <Route path="/purchases" element={<PurchasePage data={data} addPurchase={addPurchase} deletePurchase={deletePurchase} />} />
                  <Route path="/expenses" element={<ExpensePage data={data} addExpense={addExpense} deleteExpense={deleteExpense} />} />
                  <Route path="/menus" element={<MenuPage data={data} addMenu={addMenu} deleteMenu={deleteMenu} />} />
                  <Route path="/reports" element={<ReportsPage data={data} metrics={metrics} period={period} setPeriod={setPeriod} customStart={customStart} setCustomStart={setCustomStart} customEnd={customEnd} setCustomEnd={setCustomEnd} />} />
                  <Route path="/employees" element={<EmployeesPage data={data} addEmployee={saveEmployee} updateEmployeeProfile={updateEmployeeProfile} updateEmployeeStatus={updateEmployeeStatus} />} />
                  <Route path="/settings" element={<SettingsPage data={data} saveProfile={saveProfile} addCapital={addCapital} deleteCapital={deleteCapital} exportBackup={exportBackup} importBackup={importBackup} />} />
                  <Route path="/capital" element={<SettingsPage data={data} saveProfile={saveProfile} addCapital={addCapital} deleteCapital={deleteCapital} exportBackup={exportBackup} importBackup={importBackup} />} />
                  </>
                ) : (
                  <>
                  <Route path="/" element={<Navigate to="/cashier" replace />} />
                  <Route path="/cashier" element={<CashierPage data={data} addSale={addSale} />} />
                  <Route path="/sales" element={<SalesPage data={data} addSale={addSale} deleteSale={deleteSale} canDelete={false} />} />
                  <Route path="/expenses" element={<ExpensePage data={data} addExpense={addExpense} deleteExpense={deleteExpense} />} />
                  </>
                )}
                <Route path="*" element={<Navigate to={activeRole === 'owner' ? '/' : '/cashier'} replace />} />
              </Routes>
            )}
          </div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/90 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(visibleNavItems.length + 1, 4)}, minmax(0, 1fr))` }}>
          {visibleNavItems.map((item) => (
            <NavLink key={item.path} to={item.path} className="nav-link justify-center text-xs" end={item.path === '/'}>
              <span>{item.icon}</span>
            </NavLink>
          ))}
          <button className="nav-link justify-center text-xs" onClick={handleLogout} aria-label="Logout">
            <span>🚪</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const {
    login,
    register,
    resetPassword,
    authConfigured,
    authError,
    firebaseConfigError: firebaseInitializationError,
  } = useAuth();
  const [mode, setMode] = useState('login');
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('owner');
  const [status, setStatus] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus('');

    try {
      if (!authConfigured) {
        throw new Error('Firebase belum dikonfigurasi. Isi environment variables pada .env lalu mulai ulang aplikasi.');
      }

      if (mode === 'login') {
        await login({ identifier, password, loginRole: role });
        navigate(role === 'pegawai' ? '/cashier' : '/');
      } else if (mode === 'register') {
        await register({ email: identifier, password, name });
        navigate('/');
      }
    } catch (error) {
      const messages = {
        'auth/invalid-credential': 'Email atau password tidak sesuai.',
        'auth/user-not-found': 'Akun tidak ditemukan.',
        'auth/wrong-password': 'Email atau password tidak sesuai.',
        'auth/email-already-in-use': 'Email sudah terdaftar.',
        'auth/invalid-email': 'Format email tidak valid.',
        'auth/weak-password': 'Password minimal 6 karakter.',
        'auth/network-request-failed': 'Terjadi masalah koneksi. Periksa internet Anda.',
        'permission-denied': 'Firestore menolak penyiapan profil. Terapkan Firestore Rules terbaru, lalu coba login kembali untuk melanjutkan onboarding.',
        'firestore/permission-denied': 'Firestore menolak penyiapan profil. Terapkan Firestore Rules terbaru, lalu coba login kembali untuk melanjutkan onboarding.',
      };
      setStatus(messages[error.code] || error.message || 'Gagal masuk. Silakan coba lagi.');
    }
  };

  const handleReset = async () => {
    if (!identifier) {
      setStatus(role === 'pegawai' ? 'Masukkan ID Pegawai untuk reset password.' : 'Masukkan email untuk reset password.');
      return;
    }
    if (role === 'pegawai') {
      setStatus('Minta Owner mereset password akun pegawai Anda.');
      return;
    }
    try {
      if (!authConfigured) throw new Error('Firebase belum dikonfigurasi.');
      await resetPassword(identifier.trim());
      setStatus('Link reset password berhasil dikirim.');
    } catch (error) {
      setStatus(error.code === 'auth/network-request-failed'
        ? 'Terjadi masalah koneksi. Periksa internet Anda.'
        : 'Gagal mengirim tautan reset password. Periksa email atau ID Pegawai.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-100 via-white to-sky-100 px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-bold text-white">C</div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Catatan Usaha</h1>
          <p className="mt-2 text-sm text-slate-500">Kelola usaha makanan dan minuman dengan lebih mudah</p>
        </div>

        {!authConfigured && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {firebaseInitializationError || 'Firebase belum dikonfigurasi. Isi file .env dengan konfigurasi Firebase lalu mulai ulang aplikasi.'}
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
          <button className={mode === 'login' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('login')}>
            Login
          </button>
          <button className={mode === 'register' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('register')}>
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nama Pemilik</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {mode === 'register' || role === 'owner' ? 'Email' : 'ID Pegawai'}
            </label>
            <input
              className="input"
              type={mode === 'register' || role === 'owner' ? 'email' : 'text'}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {mode === 'login' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Masuk sebagai</label>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="owner">Owner</option>
                <option value="pegawai">Pegawai</option>
              </select>
            </div>
          )}

          {(status || authError) && (
            <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
              {status || authError}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={!authConfigured}>
            {mode === 'login' ? 'Masuk' : 'Daftar'}
          </button>
        </form>

        {mode === 'login' && (
          <button className="mt-4 w-full text-sm font-medium text-emerald-700" onClick={handleReset}>
            Lupa password?
          </button>
        )}
      </div>
    </div>
  );
}

function EmployeeDashboardPage({ data }) {
  const today = formatDateValue(new Date());
  const todaySales = (data.sales || []).filter((sale) => sale.date === today);
  const totalRevenue = todaySales.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const totalItems = todaySales.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const totalTransactions = todaySales.length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <div className="text-sm text-slate-500">Shift Saat Ini</div>
          <div className="mt-2 text-xl font-bold">Belum buka</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Total transaksi</div>
          <div className="mt-2 text-2xl font-bold">{totalTransactions}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Produk terjual</div>
          <div className="mt-2 text-2xl font-bold">{totalItems}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Omzet</div>
          <div className="mt-2 text-2xl font-bold">{money(totalRevenue)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <NavLink to="/cashier" className="btn-primary">Buka Shift</NavLink>
        <NavLink to="/cashier" className="btn-secondary">Kasir</NavLink>
        <button className="btn-danger">Tutup Shift</button>
      </div>
    </div>
  );
}

function CashierPage({ data, addSale }) {
  const [selectedQuantities, setSelectedQuantities] = useState({});
  const [paymentMethod, setPaymentMethod] = useState('Tunai');
  const [amountPaid, setAmountPaid] = useState(0);
  const [saved, setSaved] = useState(false);

  const menuItems = (data.menus || []).filter((menu) => menu.status !== 'nonaktif');
  const cartItems = menuItems
    .filter((menu) => Number(selectedQuantities[menu.id] || 0) > 0)
    .map((menu) => ({
      ...menu,
      qty: Number(selectedQuantities[menu.id] || 0),
      lineTotal: Number(menu.sellingPrice || 0) * Number(selectedQuantities[menu.id] || 0),
    }));

  const totalItems = cartItems.reduce((sum, item) => sum + item.qty, 0);
  const total = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const change = Number(amountPaid || 0) - total;

  const updateQty = (menuId, delta) => {
    setSaved(false);
    setSelectedQuantities((current) => {
      const nextQty = Math.max(0, Number(current[menuId] || 0) + delta);
      return { ...current, [menuId]: nextQty };
    });
    setAmountPaid((current) => (current === 0 ? total : current));
  };

  const handleFinish = () => {
    if (!cartItems.length) return;

    cartItems.forEach((item) => {
      addSale({
        menuId: item.id,
        menuName: item.name,
        qty: item.qty,
        sellingPrice: Number(item.sellingPrice || 0),
        total: item.lineTotal,
        hpp: Number(item.purchasePrice || 0) * item.qty,
        date: formatDateValue(new Date()),
        paymentMethod,
        amountPaid: Number(amountPaid || total),
        change: Math.max(0, Number(amountPaid || total) - total),
      });
    });

    setSelectedQuantities({});
    setSaved(true);
    setAmountPaid(0);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {(menuItems || []).map((menu) => (
            <div key={menu.id} className="card p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-bold text-slate-900">{menu.name}</div>
                  <div className="text-sm text-slate-500">{menu.category}</div>
                  <div className="mt-2 font-semibold text-emerald-700">{money(menu.sellingPrice)}</div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button className="btn-secondary w-10 px-0" onClick={() => updateQty(menu.id, -1)}>-</button>
                <span className="text-lg font-bold">{selectedQuantities[menu.id] || 0}</span>
                <button className="btn-secondary w-10 px-0" onClick={() => updateQty(menu.id, 1)}>+</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h2 className="text-lg font-bold">Pembayaran</h2>
        <div className="mt-4 space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div>Total item: <span className="font-bold">{totalItems}</span></div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{money(total)}</div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Metode pembayaran</label>
            <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="Tunai">Tunai</option>
              <option value="QRIS">QRIS</option>
              <option value="Transfer">Transfer</option>
              <option value="Lainnya">Lainnya</option>
            </select>
          </div>

          {paymentMethod === 'Tunai' && (
            <div>
              <label className="mb-1 block text-sm font-medium">Uang diterima</label>
              <input type="number" min="0" className="input" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
              <div className="mt-2 text-sm text-slate-600">Kembalian: {money(Math.max(change, 0))}</div>
            </div>
          )}

          <button className="btn-primary w-full" onClick={handleFinish}>Bayar</button>
          {saved && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">Transaksi berhasil disimpan.</div>}
        </div>
      </div>
    </div>
  );
}

function ShiftPage({ data }) {
  const todaySales = (data.sales || []).filter((sale) => sale.date === formatDateValue(new Date()));
  const totalRevenue = todaySales.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const totalItems = todaySales.reduce((sum, row) => sum + Number(row.qty || 0), 0);

  return (
    <div className="card p-4">
      <h2 className="text-lg font-bold">Ringkasan Shift</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-sm text-slate-500">Pegawai</div>
          <div className="mt-1 font-bold">Kasir</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-sm text-slate-500">Transaksi</div>
          <div className="mt-1 font-bold">{todaySales.length}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-sm text-slate-500">Produk terjual</div>
          <div className="mt-1 font-bold">{totalItems}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <div className="text-sm text-slate-500">Omzet</div>
          <div className="mt-1 font-bold">{money(totalRevenue)}</div>
        </div>
      </div>
    </div>
  );
}

function DashboardPage({ data, metrics, periodSeries, period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd, enrichSales }) {
  const salesView = enrichSales(data.sales || []);
  const todayCount = salesView.filter((item) => item.date === formatDateValue(new Date())).length + (data.purchases || []).filter((item) => item.date === formatDateValue(new Date())).length + (data.expenses || []).filter((item) => item.date === formatDateValue(new Date())).length;

  const cards = [
    { label: 'Modal Awal', value: metrics.totalCapitalValue, tone: 'emerald' },
    { label: 'Omzet', value: metrics.totalRevenue, tone: 'blue' },
    { label: 'Belanja', value: metrics.totalPurchases, tone: 'amber' },
    { label: 'Pengeluaran', value: metrics.totalExpenses, tone: 'rose' },
    { label: 'HPP', value: metrics.totalHpp, tone: 'violet' },
    { label: 'Estimasi Laba', value: metrics.estimatedProfit, tone: 'emerald' },
    { label: 'Perkiraan Kas', value: metrics.cashProjection, tone: 'slate' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="metric-card">
            <div className="text-sm font-medium text-slate-500">{card.label}</div>
            <div className="mt-3 text-2xl font-bold text-slate-900">{money(card.value)}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="card p-4">
          <div className="text-sm text-slate-500">Jumlah transaksi hari ini</div>
          <div className="mt-2 text-2xl font-bold">{todayCount}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Jumlah produk terjual</div>
          <div className="mt-2 text-2xl font-bold">{metrics.soldProducts}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Menu terlaris</div>
          <div className="mt-2 text-xl font-bold">{metrics.bestSeller.name}</div>
          <div className="text-sm text-slate-500">{metrics.bestSeller.value} item</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Kategori belanja terbesar</div>
          <div className="mt-2 text-xl font-bold">{metrics.purchaseLargest.name}</div>
          <div className="text-sm text-slate-500">{money(metrics.purchaseLargest.value)}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-slate-500">Kategori pengeluaran terbesar</div>
          <div className="mt-2 text-xl font-bold">{metrics.expenseLargest.name}</div>
          <div className="text-sm text-slate-500">{money(metrics.expenseLargest.value)}</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Grafik Omzet</h2>
            <span className="text-sm text-slate-500">{period}</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={periodSeries}>
                <defs>
                  <linearGradient id="revenue" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(value)} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" fill="url(#revenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-4">
            <h2 className="text-lg font-bold">Perbandingan Keuangan</h2>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={periodSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(value)} />
                <Bar dataKey="revenue" fill="#10b981" radius={4} />
                <Bar dataKey="purchase" fill="#f59e0b" radius={4} />
                <Bar dataKey="expense" fill="#ef4444" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function SalesPage({ data, addSale, deleteSale, canDelete = true }) {
  const [form, setForm] = useState({ menuId: '', qty: 1, sellingPrice: 0, date: formatDateValue(new Date()) });

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.menuId || !form.qty) return;

    const menu = (data.menus || []).find((item) => item.id === form.menuId);
    const total = Number(form.qty) * Number(form.sellingPrice || menu?.sellingPrice || 0);
    const hpp = Number(form.qty) * Number(menu?.purchasePrice || 0);

    addSale({
      menuId: form.menuId,
      menuName: menu?.name || 'Menu',
      qty: Number(form.qty),
      sellingPrice: Number(form.sellingPrice || menu?.sellingPrice || 0),
      total,
      hpp,
      date: form.date,
    });

    setForm({ menuId: '', qty: 1, sellingPrice: 0, date: formatDateValue(new Date()) });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <form onSubmit={handleSubmit} className="card p-4">
        <h2 className="text-lg font-bold">Tambah Penjualan</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Menu</label>
            <select
              className="input"
              value={form.menuId}
              onChange={(e) => {
                const menu = (data.menus || []).find((item) => item.id === e.target.value);
                setForm((prev) => ({ ...prev, menuId: e.target.value, sellingPrice: menu?.sellingPrice || 0 }));
              }}
            >
              <option value="">Pilih menu</option>
              {(data.menus || []).map((menu) => (
                <option key={menu.id} value={menu.id}>{menu.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Tanggal</label>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Jumlah</label>
            <input type="number" min="1" className="input" value={form.qty} onChange={(e) => setForm((prev) => ({ ...prev, qty: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Harga Jual</label>
            <input type="number" min="0" className="input" value={form.sellingPrice} onChange={(e) => setForm((prev) => ({ ...prev, sellingPrice: e.target.value }))} />
          </div>

          <button className="btn-primary w-full" type="submit">Simpan Penjualan</button>
        </div>
      </form>

      <div className="card p-4">
        <h2 className="text-lg font-bold">Riwayat Penjualan</h2>
        <div className="mt-4 space-y-3">
          {(data.sales || []).slice().reverse().map((item) => (
            <div key={item.id} className="rounded-2xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{item.menuName}</div>
                  <div className="text-sm text-slate-500">{item.date} • {item.qty} item</div>
                </div>
                {canDelete && <button className="btn-danger" onClick={() => deleteSale(item.id)}>Hapus</button>}
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span>Harga Jual</span>
                <span className="font-semibold">{money(item.total)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PurchasePage({ data, addPurchase, deletePurchase }) {
  const [form, setForm] = useState({ item: '', category: 'Bahan Baku', quantity: 1, cost: 0, date: formatDateValue(new Date()), notes: '' });

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.item || !form.cost) return;
    addPurchase(form);
    setForm({ item: '', category: 'Bahan Baku', quantity: 1, cost: 0, date: formatDateValue(new Date()), notes: '' });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <form onSubmit={handleSubmit} className="card p-4">
        <h2 className="text-lg font-bold">Tambah Belanja</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nama Barang</label>
            <input className="input" value={form.item} onChange={(e) => setForm((prev) => ({ ...prev, item: e.target.value }))} required />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Kategori</label>
            <select className="input" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}>
              <option value="Bahan Baku">Bahan Baku</option>
              <option value="Kemasan">Kemasan</option>
              <option value="Lainnya">Lainnya</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Tanggal</label>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Jumlah</label>
            <input type="number" min="1" className="input" value={form.quantity} onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Biaya</label>
            <input type="number" min="0" className="input" value={form.cost} onChange={(e) => setForm((prev) => ({ ...prev, cost: e.target.value }))} required />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Catatan</label>
            <textarea className="input min-h-[90px]" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </div>

          <button className="btn-primary w-full" type="submit">Simpan Belanja</button>
        </div>
      </form>

      <div className="card p-4">
        <h2 className="text-lg font-bold">Riwayat Belanja</h2>
        <div className="mt-4 space-y-3">
          {(data.purchases || []).slice().reverse().map((item) => (
            <div key={item.id} className="rounded-2xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{item.item}</div>
                  <div className="text-sm text-slate-500">{item.category} • {item.date}</div>
                </div>
                <button className="btn-danger" onClick={() => deletePurchase(item.id)}>Hapus</button>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span>Total</span>
                <span className="font-semibold">{money(item.cost)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExpensePage({ data, addExpense, deleteExpense }) {
  const [form, setForm] = useState({
    itemName: '',
    category: 'Operasional',
    quantity: 1,
    unitPrice: 0,
    total: 0,
    date: formatDateValue(new Date()),
    notes: '',
  });

  const totalValue = Number(form.quantity || 0) * Number(form.unitPrice || 0);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.itemName || !form.quantity || !form.unitPrice) return;
    addExpense({
      ...form,
      total: totalValue,
      quantity: Number(form.quantity || 0),
      unitPrice: Number(form.unitPrice || 0),
    });
    setForm({ itemName: '', category: 'Operasional', quantity: 1, unitPrice: 0, total: 0, date: formatDateValue(new Date()), notes: '' });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <form onSubmit={handleSubmit} className="card p-4">
        <h2 className="text-lg font-bold">Tambah Pengeluaran</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Judul</label>
            <input
              className="input"
              value={form.itemName}
              onChange={(e) => setForm((prev) => ({ ...prev, itemName: e.target.value }))}
              placeholder="Es Batu Kristal"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Kategori</label>
            <select className="input" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}>
              <option value="Operasional">Operasional</option>
              <option value="Transportasi">Transportasi</option>
              <option value="Gaji">Gaji</option>
              <option value="Lainnya">Lainnya</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Tanggal</label>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Jumlah</label>
              <input
                type="number"
                min="0"
                className="input"
                value={form.quantity}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    quantity: e.target.value,
                    total: Number(e.target.value || 0) * Number(prev.unitPrice || 0),
                  }))
                }
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Harga Satuan</label>
              <input
                type="number"
                min="0"
                className="input"
                value={form.unitPrice}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    unitPrice: e.target.value,
                    total: Number(prev.quantity || 0) * Number(e.target.value || 0),
                  }))
                }
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Total</label>
            <input className="input" value={money(totalValue)} readOnly />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Catatan</label>
            <textarea className="input min-h-[90px]" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </div>

          <button className="btn-primary w-full" type="submit">Simpan Pengeluaran</button>
        </div>
      </form>

      <div className="card p-4">
        <h2 className="text-lg font-bold">Riwayat Pengeluaran</h2>
        <div className="mt-4 space-y-3">
          {(data.expenses || []).slice().reverse().map((item) => {
            const itemName = item.itemName || item.title || 'Item';
            const total = Number(item.total ?? item.amount ?? 0);
            const unitPrice = Number(item.unitPrice ?? 0);
            const quantity = Number(item.quantity ?? 0);

            return (
              <div key={item.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{itemName}</div>
                    <div className="text-sm text-slate-500">{quantity} × {money(unitPrice)} • {item.category} • {item.date}</div>
                  </div>
                  <button className="btn-danger" onClick={() => deleteExpense(item.id)}>Hapus</button>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span>Total</span>
                  <span className="font-semibold">{money(total)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MenuPage({ data, addMenu, deleteMenu }) {
  const [form, setForm] = useState({ name: '', category: 'Makanan', purchasePrice: 0, sellingPrice: 0, unit: 'porsi', status: 'aktif' });

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.name || !form.sellingPrice || !form.purchasePrice) return;
    addMenu({ ...form, status: form.status || 'aktif' });
    setForm({ name: '', category: 'Makanan', purchasePrice: 0, sellingPrice: 0, unit: 'porsi', status: 'aktif' });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <form onSubmit={handleSubmit} className="card p-4">
        <h2 className="text-lg font-bold">Tambah Menu</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nama Menu</label>
            <input className="input" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} required />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Kategori</label>
            <select className="input" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}>
              <option value="Makanan">Makanan</option>
              <option value="Minuman">Minuman</option>
              <option value="Cemilan">Cemilan</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">HP P</label>
            <input type="number" min="0" className="input" value={form.purchasePrice} onChange={(e) => setForm((prev) => ({ ...prev, purchasePrice: e.target.value }))} required />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Harga Jual</label>
            <input type="number" min="0" className="input" value={form.sellingPrice} onChange={(e) => setForm((prev) => ({ ...prev, sellingPrice: e.target.value }))} required />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Satuan</label>
            <input className="input" value={form.unit} onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Status</label>
            <select className="input" value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="aktif">Aktif</option>
              <option value="nonaktif">Nonaktif</option>
            </select>
          </div>

          <button className="btn-primary w-full" type="submit">Simpan Menu</button>
        </div>
      </form>

      <div className="card p-4">
        <h2 className="text-lg font-bold">Daftar Menu</h2>
        <div className="mt-4 space-y-3">
          {(data.menus || []).map((menu) => (
            <div key={menu.id} className="rounded-2xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{menu.name}</div>
                  <div className="text-sm text-slate-500">{menu.category} • {menu.status || 'aktif'}</div>
                </div>
                <button className="btn-danger" onClick={() => deleteMenu(menu.id)}>Hapus</button>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span>HPP</span>
                <span>{money(menu.purchasePrice)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span>Harga Jual</span>
                <span>{money(menu.sellingPrice)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportsPage({ data, metrics, period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd }) {
  const summary = [
    { label: 'Omzet', value: metrics.totalRevenue },
    { label: 'Belanja', value: metrics.totalPurchases },
    { label: 'Pengeluaran', value: metrics.totalExpenses },
    { label: 'Laba', value: metrics.estimatedProfit },
  ];

  const categorySummary = [
    { name: 'Omzet', value: metrics.totalRevenue },
    { name: 'Belanja', value: metrics.totalPurchases },
    { name: 'Pengeluaran', value: metrics.totalExpenses },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {summary.map((item) => (
          <div key={item.label} className="metric-card">
            <div className="text-sm text-slate-500">{item.label}</div>
            <div className="mt-2 text-2xl font-bold">{money(item.value)}</div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Ringkasan laporan</h2>
          <div className="flex gap-2">
            <select className="input max-w-[140px]" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="today">Hari ini</option>
              <option value="week">7 hari</option>
              <option value="month">Bulan ini</option>
              <option value="custom">Custom</option>
            </select>
            {period === 'custom' && (
              <>
                <input type="date" className="input max-w-[130px]" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                <input type="date" className="input max-w-[130px]" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </>
            )}
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categorySummary}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip formatter={(value) => money(value)} />
              <Bar dataKey="value" radius={8} fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function EmployeesPage({ data, addEmployee, updateEmployeeProfile, updateEmployeeStatus }) {
  const emptyForm = { employeeId: '', name: '', authUid: '' };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [consoleOpened, setConsoleOpened] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [pasteFeedback, setPasteFeedback] = useState('');

  const employeeId = form.employeeId.trim();
  let internalEmail = '';
  try {
    if (employeeId) internalEmail = employeeInternalEmail(employeeId);
  } catch {
    internalEmail = '';
  }
  const idExists = (data.users || []).some((person) => (
    person.id !== editingId
    && typeof person.employeeId === 'string'
    && person.employeeId.trim().toUpperCase() === employeeId.toUpperCase()
  ));
  const emailExists = Boolean(internalEmail) && (data.users || []).some((person) => {
    if (person.id === editingId || (person.role !== 'employee' && person.role !== 'pegawai')) return false;
    try {
      return employeeInternalEmail(person.employeeId) === internalEmail;
    } catch {
      return false;
    }
  });
  const authUid = form.authUid.trim();
  const validUid = Boolean(authUid) && authUid.length <= 128 && !/[\s/]/.test(authUid);
  const authConsoleUrl = firebaseConfig.projectId
    ? `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/users`
    : 'https://console.firebase.google.com/';
  const employees = (data.users || []).filter((person) => person.role === 'employee' || person.role === 'pegawai');

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId('');
    setConsoleOpened(false);
    setCopyFeedback('');
    setPasteFeedback('');
  };

  const handleCopyEmail = async () => {
    if (!internalEmail) return;
    try {
      await navigator.clipboard.writeText(internalEmail);
      setCopyFeedback('Email internal disalin.');
    } catch {
      setCopyFeedback('Salin email dari kolom di atas secara manual.');
    }
  };

  const handlePasteUid = async () => {
    try {
      const pastedUid = await navigator.clipboard.readText();
      if (!pastedUid.trim()) {
        setPasteFeedback('Clipboard kosong. Tempel UID langsung ke kolom.');
        return;
      }
      setForm((previous) => ({ ...previous, authUid: pastedUid.trim() }));
      setPasteFeedback('');
    } catch {
      setPasteFeedback('Browser tidak memberi akses clipboard. Tempel UID langsung ke kolom.');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus('');
    setSaving(true);
    try {
      if (!form.name.trim()) throw new Error('Nama Pegawai wajib diisi.');
      if (!internalEmail) throw new Error('ID Pegawai harus 3–20 karakter: huruf, angka, - atau _.');
      if (idExists) throw new Error('ID Pegawai sudah terdaftar.');
      if (emailExists) {
        throw new Error('Email internal ini sudah digunakan oleh pegawai lain. Gunakan ID Pegawai yang berbeda.');
      }
      if (!validUid) throw new Error('Tempel UID Firebase tanpa spasi dari Firebase Console.');

      if (editingId) {
        await updateEmployeeProfile({ id: editingId, authUid: editingId, employeeId }, form.name);
        setStatus('Nama pegawai berhasil diperbarui. UID Firebase dan ID Pegawai tetap.');
      } else {
        await addEmployee(form);
        setStatus('Pegawai berhasil ditambahkan. Login pegawai menggunakan ID Pegawai dan password Firebase.');
      }
      resetForm();
    } catch (error) {
      setStatus(error.message || 'Gagal menyimpan profil pegawai. Periksa UID dan coba lagi.');
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (employee) => {
    setStatus('');
    setForm({
      employeeId: employee.employeeId || '',
      name: employee.name || '',
      authUid: employee.authUid || employee.id,
    });
    setEditingId(employee.id);
    setConsoleOpened(false);
  };

  const handleStatusChange = async (employee) => {
    setStatus('');
    try {
      const isActive = employee.status !== 'inactive' && employee.active !== false;
      if (isActive && !window.confirm(`Nonaktifkan pegawai ${employee.name}?`)) return;
      await updateEmployeeStatus(employee, !isActive);
      setStatus(!isActive
        ? 'Pegawai berhasil diaktifkan.'
        : 'Pegawai berhasil dinonaktifkan. Data dan riwayat transaksi tetap tersimpan. Nonaktifkan juga akun Authentication di Firebase Console untuk menghentikan login.');
    } catch (error) {
      setStatus(error.message || 'Gagal memperbarui status pegawai.');
    }
  };

  const stepItems = [
    { label: 'Data pegawai', complete: Boolean(form.name.trim() && internalEmail && !idExists) },
    { label: 'Buat akun Firebase', complete: consoleOpened || Boolean(editingId) },
    { label: 'Hubungkan UID', complete: validUid },
    { label: 'Pegawai siap login', complete: status.startsWith('Pegawai berhasil') || Boolean(editingId) },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <section className="space-y-4">
        <form onSubmit={handleSubmit} className="card space-y-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">{editingId ? 'Edit Pegawai' : 'Tambah Pegawai'}</h2>
            {editingId && (
              <button className="btn-secondary text-sm" type="button" onClick={resetForm}>Batal</button>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="employee-name">Nama Pegawai</label>
            <input
              id="employee-name"
              className="input"
              value={form.name}
              onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
              maxLength={100}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="employee-id">ID Pegawai</label>
            <input
              id="employee-id"
              className="input"
              value={form.employeeId}
              onChange={(event) => setForm((previous) => ({ ...previous, employeeId: event.target.value }))}
              minLength={3}
              maxLength={20}
              pattern="[^\\s/]+"
              readOnly={Boolean(editingId)}
              required
            />
            {editingId && (
              <p className="mt-1 text-xs text-amber-800">
                ID tidak dapat diubah setelah terhubung karena menentukan email login. Perubahan ID tidak mengubah email Firebase Authentication.
              </p>
            )}
          </div>

          {internalEmail && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-3">
              <label className="block text-sm font-medium text-slate-800" htmlFor="employee-internal-email">Email Firebase internal</label>
              <div className="flex gap-2">
                <input
                  id="employee-internal-email"
                  className="input min-w-0"
                  value={internalEmail}
                  readOnly
                  aria-describedby="employee-email-help"
                />
                <button className="btn-secondary shrink-0" type="button" onClick={handleCopyEmail}>Salin Email</button>
              </div>
              <p id="employee-email-help" className="text-xs text-slate-700">
                Email ini hanya digunakan untuk membuat akun Firebase Authentication. Pegawai tetap login menggunakan ID Pegawai.
              </p>
              {copyFeedback && <p role="status" className="text-xs text-slate-700">{copyFeedback}</p>}
              {(idExists || emailExists) && !editingId && (
                <p role="alert" className="text-sm font-medium text-rose-700">
                  {idExists ? 'ID Pegawai sudah terdaftar.' : 'Email internal ini sudah digunakan oleh pegawai lain. Gunakan ID Pegawai yang berbeda.'}
                </p>
              )}
            </div>
          )}

          {!editingId && internalEmail && !idExists && !emailExists && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Akun Firebase Pegawai</h3>
                <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-slate-700">
                  <li>Buka Firebase Authentication dan tambahkan pengguna.</li>
                  <li>Gunakan email internal di atas dan buat password.</li>
                  <li>Salin UID Firebase, lalu tempel di bawah.</li>
                </ol>
                <p className="mt-2 text-xs text-slate-600">
                  Password dibuat di Firebase Console. Jangan masukkan password ke aplikasi. Jika email sudah terdaftar di Firebase, gunakan UID akun dengan email yang sama.
                </p>
              </div>
              <a
                className="btn-secondary inline-flex"
                href={authConsoleUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setConsoleOpened(true)}
              >
                Buka Firebase Authentication
              </a>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="employee-auth-uid">UID Firebase Authentication</label>
                <div className="flex gap-2">
                  <input
                    id="employee-auth-uid"
                    className="input min-w-0"
                    value={form.authUid}
                    onChange={(event) => setForm((previous) => ({ ...previous, authUid: event.target.value }))}
                    placeholder="Tempel UID dari Firebase Console"
                    autoComplete="off"
                    maxLength={128}
                    pattern="[^\\s/]+"
                    required
                  />
                  <button className="btn-secondary shrink-0" type="button" onClick={handlePasteUid}>Tempel UID</button>
                </div>
                {pasteFeedback && <p role="status" className="mt-1 text-xs text-amber-800">{pasteFeedback}</p>}
              </div>
            </div>
          )}

          <ol aria-label="Tahapan menambahkan pegawai" className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
            {stepItems.map((step, index) => (
              <li key={step.label} className={`flex items-center gap-1.5 ${step.complete ? 'text-emerald-800' : 'text-slate-500'}`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${step.complete ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                  {step.complete ? '✓' : index + 1}
                </span>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>

          {status && <div role="status" className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{status}</div>}
          <button className="btn-primary w-full" type="submit" disabled={saving || (editingId ? !form.name.trim() : !internalEmail || idExists || emailExists || !validUid)}>
            {saving ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Simpan Pegawai'}
          </button>
        </form>
      </section>

      <div className="card p-4">
        <h2 className="text-lg font-bold">Daftar Pegawai</h2>
        <div className="mt-4 space-y-3">
          {employees.length === 0 && (
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Belum ada pegawai. Isi data pegawai, buat akun Authentication, lalu hubungkan UID-nya.</div>
          )}
          {employees.map((employee) => {
            const isActive = employee.status !== 'inactive' && employee.active !== false;
            const linked = Boolean(employee.authUid || employee.id);
            let email = employee.email || '';
            if (!email) {
              try {
                email = employeeInternalEmail(employee.employeeId);
              } catch {
                email = '';
              }
            }
            return (
              <div key={employee.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <div className="font-semibold">{employee.name || employee.employeeId}</div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-slate-600">ID Pegawai</dt>
                    <dd className="font-medium text-slate-900">{employee.employeeId}</dd>
                    <dt className="text-slate-600">Status</dt>
                    <dd className={isActive ? 'font-medium text-emerald-800' : 'font-medium text-slate-600'}>
                      {isActive ? '● Aktif' : '● Nonaktif'}
                    </dd>
                    <dt className="text-slate-600">Akun Firebase</dt>
                    <dd className={linked ? 'font-medium text-emerald-800' : 'font-medium text-amber-800'}>
                      {linked ? '✓ Terhubung' : 'Menunggu akun Firebase'}
                    </dd>
                  </dl>
                  {linked && (
                    <button
                      type="button"
                      className="mt-1 text-xs font-medium text-slate-600 underline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(email);
                          setStatus('Email internal disalin. Pegawai tetap login menggunakan ID.');
                        } catch {
                          setStatus(`Email internal: ${email}. Salin secara manual jika diperlukan.`);
                        }
                      }}
                    >
                      Salin email internal
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary" type="button" onClick={() => startEditing(employee)}>Edit</button>
                  <button className="btn-secondary" type="button" onClick={() => handleStatusChange(employee)}>
                    {isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ data, saveProfile, addCapital, deleteCapital, exportBackup, importBackup }) {
  const [profileForm, setProfileForm] = useState(data.profile || defaultProfile);
  const [capitalForm, setCapitalForm] = useState({ amount: 150000, source: 'Modal awal', date: formatDateValue(new Date()), notes: '' });

  useEffect(() => {
    setProfileForm(data.profile || defaultProfile);
  }, [data.profile]);

  const handleProfileSave = (event) => {
    event.preventDefault();
    saveProfile(profileForm);
  };

  const handleCapitalSave = (event) => {
    event.preventDefault();
    if (!capitalForm.amount) return;
    addCapital(capitalForm);
    setCapitalForm({ amount: 0, source: 'Modal awal', date: formatDateValue(new Date()), notes: '' });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <form onSubmit={handleProfileSave} className="card p-4">
        <h2 className="text-lg font-bold">Profil Usaha</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Nama Usaha</label>
            <input className="input" value={profileForm.businessName} onChange={(e) => setProfileForm((prev) => ({ ...prev, businessName: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Nama Pemilik</label>
            <input className="input" value={profileForm.ownerName} onChange={(e) => setProfileForm((prev) => ({ ...prev, ownerName: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Alamat</label>
            <textarea className="input min-h-[90px]" value={profileForm.address} onChange={(e) => setProfileForm((prev) => ({ ...prev, address: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Telepon</label>
            <input className="input" value={profileForm.phone} onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))} />
          </div>
          <button className="btn-primary w-full" type="submit">Simpan Profil</button>
        </div>
      </form>

      <div className="space-y-6">
        <form onSubmit={handleCapitalSave} className="card p-4">
          <h2 className="text-lg font-bold">Modal Awal</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Jumlah Modal</label>
              <input type="number" min="0" className="input" value={capitalForm.amount} onChange={(e) => setCapitalForm((prev) => ({ ...prev, amount: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Sumber</label>
              <input className="input" value={capitalForm.source} onChange={(e) => setCapitalForm((prev) => ({ ...prev, source: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Tanggal</label>
              <input type="date" className="input" value={capitalForm.date} onChange={(e) => setCapitalForm((prev) => ({ ...prev, date: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Catatan</label>
              <textarea className="input min-h-[90px]" value={capitalForm.notes} onChange={(e) => setCapitalForm((prev) => ({ ...prev, notes: e.target.value }))} />
            </div>
            <button className="btn-primary w-full" type="submit">Simpan Modal</button>
          </div>
        </form>

        <div className="card p-4">
          <h2 className="text-lg font-bold">Backup & Restore</h2>
          <div className="mt-4 space-y-3">
            <button className="btn-primary w-full" onClick={exportBackup}>Export Backup</button>
            <label className="block">
              <span className="sr-only">Import backup</span>
              <input type="file" accept="application/json" className="hidden" id="backup-file" onChange={importBackup} />
              <span className="btn-secondary inline-flex w-full cursor-pointer items-center justify-center">Import Backup</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
