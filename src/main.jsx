import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './App';
import './index.css';

class AppErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught application render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const rawDetail = `${this.state.error?.name || 'Error'}: ${this.state.error?.message || 'Kesalahan tidak diketahui.'}`;
      const detail = Object.entries(import.meta.env)
        .filter(([key, value]) => key.startsWith('VITE_FIREBASE_') && typeof value === 'string' && value)
        .reduce((message, [, value]) => message.split(value).join('[disembunyikan]'), rawDetail)
        .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[disembunyikan]');

      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-soft">
            <h1 className="text-lg font-bold text-slate-900">Terjadi kesalahan pada aplikasi.</h1>
            <p className="mt-2 text-sm text-slate-600">Silakan muat ulang halaman.</p>
            {import.meta.env.DEV && (
              <pre className="mt-4 overflow-auto rounded-xl bg-slate-50 p-3 text-left text-xs text-slate-700">
                {detail}
              </pre>
            )}
            <button className="btn-primary mt-5" onClick={() => window.location.reload()}>
              Muat Ulang
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  </AppErrorBoundary>,
);
