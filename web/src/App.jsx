import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const APK_URL = import.meta.env.VITE_APP_APK_URL || '/NavexaAI.apk';
const TOKEN_KEY = 'navexa_web_token';
const USER_KEY = 'navexa_web_user';

const features = [
  'Voice-first driving companion for navigation, music, and quick actions',
  'Protected dashboard with trips, stats, and account settings',
  'Android APK download for in-car screens',
  'Built on the same backend used by the mobile app',
];

const statsBadges = [
  { label: 'Trip history', value: 'Live' },
  { label: 'Voice companion', value: 'AI powered' },
  { label: 'Mobile download', value: 'APK ready' },
];

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = payload?.message || payload?.error || 'Request failed';
    throw new Error(message);
  }

  return payload;
}

function ShellCard({ title, subtitle, children, action }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h3>{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function LandingPage() {
  const navigate = useNavigate();

  return (
    <main className="page page--landing">
      <header className="hero">
        <nav className="topbar">
          <div>
            <span className="brand-mark">NavexaAI </span>
            <span className="brand-name"> Vehicle Companion</span>
          </div>
          <div className="topbar__actions">
            <button className="ghost-button" onClick={() => navigate('/dashboard')} type="button">
              Open dashboard
            </button>
            <a className="primary-button" href={APK_URL} download>
              Download APK
            </a>
          </div>
        </nav>

        <div className="hero__grid">
          <div className="hero__content">
            <p className="eyebrow">Companion website for the Navexa ecosystem</p>
            <h1>
              A focused control center for trips, settings, and your in-car Android screen.
            </h1>
            <p className="hero__copy">
              Use this website to understand your trips, manage your account, and quickly download the Android APK for your dashboard display.
              The dashboard is protected and requires login, while this landing page stays public.
            </p>
            <div className="hero__actions">
              <a className="primary-button" href={APK_URL} download>
                Download Android APK
              </a>
              <button className="secondary-button" onClick={() => navigate('/dashboard')} type="button">
                Sign in to dashboard
              </button>
            </div>
            <div className="stats-row">
              {statsBadges.map((item) => (
                <div className="stat-chip" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>

          <aside className="hero__glass">
            <div className="phone-frame">
              <div className="phone-frame__screen">
                <div className="mini-card mini-card--accent">
                  <span>Now playing</span>
                  <strong>Navigation ready</strong>
                </div>
                <div className="mini-card">
                  <span>Trip mode</span>
                  <strong>Voice enabled</strong>
                </div>
                <div className="mini-card">
                  <span>APK</span>
                  <strong>Download for Android screens</strong>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </header>

      <section className="content-grid">
        <ShellCard title="What this companion site does" subtitle="Overview">
          <ul className="feature-list">
            {features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </ShellCard>

        <ShellCard title="Built for the Navexa stack" subtitle="Architecture">
          <div className="stack-list">
            <span>React + Vite website</span>
            <span>Express backend integration</span>
            <span>MongoDB-powered trip data</span>
            <span>Protected dashboard routes</span>
          </div>
        </ShellCard>
      </section>
    </main>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const [authUser, setAuthUser] = useState(() => readStoredUser());
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState({
    settings: null,
    profile: null,
    trips: [],
    stats: null,
  });

  const isAuthed = Boolean(token && authUser);

  useEffect(() => {
    if (!isAuthed) {
      setDashboard({ settings: null, profile: null, trips: [], stats: null });
      return;
    }

    let cancelled = false;

    const loadDashboard = async () => {
      try {
        setLoading(true);
        setError('');
        const [settingsResult, statsResult, historyResult] = await Promise.all([
          apiRequest('/api/settings'),
          apiRequest('/api/trips/stats'),
          apiRequest('/api/trips/history?limit=5'),
        ]);

        if (cancelled) return;

        setDashboard({
          settings: settingsResult?.settings || null,
          profile: settingsResult?.profile || authUser,
          trips: historyResult?.trips || [],
          stats: statsResult || null,
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message || 'Could not load dashboard data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [authUser, isAuthed]);

  const handleLogin = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      setError('');
      const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm),
      });

      localStorage.setItem(TOKEN_KEY, response.token);
      localStorage.setItem(USER_KEY, JSON.stringify(response.user));
      setToken(response.token);
      setAuthUser(response.user);
      setLoginForm({ email: '', password: '' });
    } catch (requestError) {
      setError(requestError.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken('');
    setAuthUser(null);
    setDashboard({ settings: null, profile: null, trips: [], stats: null });
    navigate('/');
  };

  if (!isAuthed) {
    return (
      <main className="page page--dashboard page--auth">
        <section className="auth-card">
          <p className="eyebrow">Protected dashboard</p>
          <h1>Sign in to view trips and settings</h1>
          <p>
            The dashboard stays locked until you log in. After sign-in you can review trip history, account settings, and live stats.
          </p>
          <form className="auth-form" onSubmit={handleLogin}>
            <label>
              Email
              <input
                autoComplete="email"
                required
                type="email"
                value={loginForm.email}
                onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                required
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
            {error ? <div className="message message--error">{error}</div> : null}
            <button className="primary-button primary-button--full" disabled={loading} type="submit">
              {loading ? 'Signing in...' : 'Login to dashboard'}
            </button>
          </form>
          <button className="ghost-button ghost-button--wide" onClick={() => navigate('/')} type="button">
            Back to landing page
          </button>
        </section>
      </main>
    );
  }

  const tripCount = dashboard.stats?.totalTrips ?? dashboard.trips.length ?? 0;
  const distance = dashboard.stats?.totalKm ?? 0;

  return (
    <main className="page page--dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>{authUser?.name || 'Navexa user'}</h1>
          <p>{authUser?.email}</p>
        </div>
        <div className="dashboard-header__actions">
          <a className="secondary-button" href={APK_URL} download>
            Download APK
          </a>
          <button className="ghost-button" onClick={handleLogout} type="button">
            Logout
          </button>
        </div>
      </header>

      {error ? <div className="message message--error">{error}</div> : null}
      {loading ? <div className="message">Loading dashboard data...</div> : null}

      <section className="metrics-grid">
        <article className="metric-card">
          <span>Total trips</span>
          <strong>{tripCount}</strong>
        </article>
        <article className="metric-card">
          <span>Total distance</span>
          <strong>{Number(distance).toFixed(1)} km</strong>
        </article>
        <article className="metric-card">
          <span>Voice profiles</span>
          <strong>{dashboard.stats?.totalVoiceSignatures ?? 0}</strong>
        </article>
      </section>

      <section className="dashboard-grid">
        <ShellCard title="Recent trips" subtitle="Trip history">
          <div className="table-card">
            {dashboard.trips.length ? (
              dashboard.trips.map((trip) => (
                <div className="trip-row" key={trip._id}>
                  <div>
                    <strong>{trip.destination?.address || 'Saved route'}</strong>
                    <span>{trip.origin?.address || 'Current location'} → {trip.destination?.address || 'Destination'}</span>
                  </div>
                  <div>
                    <span>{trip.distanceKm?.toFixed?.(1) || Number(trip.distanceKm || 0).toFixed(1)} km</span>
                    <span>{trip.durationMinutes || 0} min</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-state">No completed trips yet.</p>
            )}
          </div>
        </ShellCard>

        <ShellCard title="Profile and settings" subtitle="Account">
          <div className="details-list">
            <div>
              <span>Name</span>
              <strong>{dashboard.profile?.name || authUser?.name || 'Not set'}</strong>
            </div>
            <div>
              <span>Email</span>
              <strong>{dashboard.profile?.email || authUser?.email || 'Not set'}</strong>
            </div>
            <div>
              <span>Voice assistant</span>
              <strong>{dashboard.settings?.ttsVoiceId || 'Default voice'}</strong>
            </div>
            <div>
              <span>Proactive mode</span>
              <strong>{dashboard.settings?.isProactiveEnabled ? 'Enabled' : 'Disabled'}</strong>
            </div>
            <div>
              <span>Proactive interval</span>
              <strong>{dashboard.settings?.proactiveIntervalMinutes ?? 5} min</strong>
            </div>
          </div>
        </ShellCard>
      </section>
    </main>
  );
}

function AppRoutes() {
  const location = useLocation();
  const rememberRoute = useMemo(() => location.pathname, [location.pathname]);

  useEffect(() => {
    document.title = rememberRoute === '/dashboard' ? 'Navexa Companion - Dashboard' : 'Navexa Companion';
  }, [rememberRoute]);

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
