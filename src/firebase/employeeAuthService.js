import { signInWithEmailAndPassword } from '@firebase/auth';

const INTERNAL_AUTH_DOMAIN = 'internal.catatanusaha.app';

export function normalizeEmployeeId(employeeId) {
  if (typeof employeeId !== 'string') {
    throw new Error('ID Pegawai wajib diisi.');
  }

  const normalizedId = employeeId.trim();
  if (normalizedId.length < 3 || normalizedId.length > 20 || /[\s/]/.test(normalizedId)) {
    throw new Error('ID Pegawai harus 3–20 karakter dan tidak boleh berisi spasi.');
  }
  return normalizedId;
}

export function employeeIdKey(employeeId) {
  return normalizeEmployeeId(employeeId).toUpperCase();
}

export function employeeInternalEmail(employeeId) {
  const normalizedId = normalizeEmployeeId(employeeId);
  const emailLocalPart = normalizedId.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!emailLocalPart) {
    throw new Error('ID Pegawai tidak dapat digunakan untuk membuat email internal.');
  }
  return `${emailLocalPart}@${INTERNAL_AUTH_DOMAIN}`;
}

export function normalizeEmployeeAuthUid(authUid) {
  if (typeof authUid !== 'string') {
    throw new Error('Tempel UID Firebase Authentication.');
  }
  const normalizedUid = authUid.trim();
  if (!normalizedUid || normalizedUid.length > 128 || /[\s/]/.test(normalizedUid)) {
    throw new Error('UID tidak valid. Tempel UID tanpa spasi dari Firebase Console.');
  }
  return normalizedUid;
}

export function signInEmployee(auth, employeeId, password) {
  if (!auth) {
    throw new Error('Firebase Authentication belum dikonfigurasi.');
  }
  return signInWithEmailAndPassword(auth, employeeInternalEmail(employeeId), password);
}
