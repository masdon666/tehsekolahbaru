# Catatan Usaha

Aplikasi React + Vite untuk pencatatan operasional dan keuangan bisnis. Aplikasi memakai Firebase Authentication Email/Password dan Cloud Firestore, tanpa Cloud Functions, Firebase Admin SDK, atau layanan backend berbayar.

## Paket Firebase

Aplikasi web dapat digunakan pada Firebase Spark Plan selama pemakaian berada dalam kuota gratis. Cloud Functions, Admin SDK, Blaze Plan, kartu kredit, dan billing tidak diperlukan. Spark memiliki batas pemakaian; jika kuota habis, operasi Firebase dapat tertolak sampai kuota tersedia kembali. Jangan mengaktifkan upgrade billing jika ingin tetap di Spark.

## Setup lokal

1. Di Firebase Console, buat project di Spark Plan.
2. Aktifkan **Authentication → Sign-in method → Email/Password**.
3. Buat database **Cloud Firestore** dalam production mode, lalu terapkan [firestore.rules](./firestore.rules) dan [firestore.indexes.json](./firestore.indexes.json):

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use <project-id>
   firebase deploy --only firestore:rules,firestore:indexes
   ```

4. Salin `.env.example` menjadi `.env` dan isi konfigurasi Firebase Web App. `VITE_BUSINESS_ID` boleh dikosongkan; login Owner dan Pegawai mengambil `businessId` dari `users/{uid}`. Variabel ini hanya dapat membantu pemulihan akun Owner lama yang belum memiliki profil root.
5. Pasang dependency dan jalankan:

   ```bash
   npm install
   npm run dev
   ```

6. Daftarkan Owner dari layar aplikasi. Aplikasi membuat ID bisnis acak, profil Owner, membership, profil bisnis, dan 12 menu awal secara atomik. Form modal awal dimulai dari Rp150.000.

## Login Owner

Owner mendaftar atau login dengan email dan password Firebase Authentication. Profile `users/{uid}` menyimpan role dan `businessId`; membership bisnis pada `businesses/{businessId}/users/{uid}` juga diperiksa sebelum akses diberikan. Menu, penjualan, dan data usaha tetap berada dalam `businesses/{businessId}/...`.

## Membuat akun pegawai

Firebase Web SDK tidak boleh membuat user Authentication pegawai dari sesi Owner: `createUserWithEmailAndPassword()` akan mengganti sesi Owner. Tanpa Cloud Functions/Admin SDK atau server tepercaya, aplikasi juga tidak dapat membuat akun Auth lain dengan aman. Karena itu, pembuatan akun Auth dilakukan manual di Firebase Console, lalu Owner menyimpan profil pegawai di aplikasi.

1. Di **Kelola Pegawai**, isi Nama Pegawai dan ID Pegawai, misalnya `ASEP01`. Form menampilkan email internal yang dibentuk otomatis, misalnya `asep01@internal.catatanusaha.app`.
2. Buka **Firebase Authentication → Users → Add user**. Gunakan email internal tersebut dan buat password. Email ini tidak ditampilkan pada layar login pegawai.
3. Salin UID user yang baru dibuat dari Firebase Console.
4. Kembali ke aplikasi, masukkan UID pada form pegawai dan simpan profil.
5. Berikan ID Pegawai dan password langsung kepada pegawai melalui saluran yang aman. Jangan masukkan password ke aplikasi atau Firestore.

Aplikasi memeriksa agar ID Pegawai belum digunakan dalam bisnis dan menyimpan membership berisi `authUid`, `employeeId`, `name`, `role`, `businessId`, dan status. Tidak ada password atau password hash yang disimpan.

ID internal berbasis email bersifat unik global di Firebase Authentication. Jika alamat email sudah dipakai project/bisnis lain, pilih ID berbeda. Akun Auth yang dibuat tetapi belum dipasangkan dengan profil bisnis tidak mendapat akses ke data aplikasi.

## Login, status, dan password pegawai

Pegawai cukup mengisi ID Pegawai dan password. Aplikasi mengubah ID menjadi email internal lalu masuk melalui Firebase Authentication Email/Password. Setelah itu, Firestore Rules memeriksa UID dan membership aktif. Pegawai tidak melihat atau perlu mengingat email internal.

Owner dapat mengaktifkan atau menonaktifkan akses Firestore pegawai di aplikasi. Penonaktifan profil langsung memblokir akses Firestore dan aplikasi mengeluarkan pegawai saat perubahan terdeteksi. Firebase Spark tanpa backend tidak dapat menonaktifkan akun Authentication dari aplikasi, jadi nonaktifkan/hapus juga user di Firebase Console untuk mencegah login Auth. Saat mengaktifkan pegawai kembali, pastikan akun Auth tersebut juga aktif.

Reset password dilakukan dari Firebase Console pada user dengan email internal yang terlihat di daftar pegawai Owner. Pegawai tidak dapat mereset password lewat formulir aplikasi.

## Batasan keamanan Spark

- Owner dan pegawai sama-sama memakai Firebase Authentication. Tidak ada autentikasi pegawai custom dan tidak ada session pegawai di `sessionStorage`.
- Security Rules menggunakan `request.auth.uid`, role, status, dan businessId. Pegawai hanya membaca menu aktif, penjualan miliknya, pengeluaran miliknya, dan shift miliknya; akses ke HPP, belanja, modal, laporan, pengaturan, dan data pegawai lain ditolak.
- Keamanan Firestore berlaku saat profil pegawai telah disimpan. Jangan membagikan email/password Auth sebelum profil selesai dibuat.
- Pengelolaan akun Auth pegawai, reset password, dan penonaktifan Auth membutuhkan tindakan manual Owner di Firebase Console. Profil/status aplikasi tidak dapat mengubah password atau status Auth.
- Tidak ada Firebase Admin SDK credential atau password di frontend/Firestore. Konfigurasi `VITE_*` adalah Firebase Web App config, bukan kredensial Admin.

## Environment variables

Untuk Vercel atau platform web lain, tambahkan variabel berikut saat build:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_BUSINESS_ID` (opsional, hanya fallback pemulihan Owner lama; tidak digunakan untuk login pegawai)

## Validasi lokal

```bash
npm install
npm run build
npm run test:rules
```

Rules test mencakup penolakan akses tanpa login, isolasi Owner antar bisnis, hak akses pegawai, data keuangan Owner, dan batch onboarding Owner. Uji alur login serta transaksi menggunakan akun Firebase Anda sebelum deployment.
