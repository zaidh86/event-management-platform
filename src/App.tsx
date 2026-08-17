import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { isSupabaseConfigured } from './lib/supabase'
import { AppLayout } from './components/Layout'
import { RequireAuth } from './components/Guards'
import { LoginPage } from './pages/auth/LoginPage'
import { SignupPage } from './pages/auth/SignupPage'
import { HomePage } from './pages/HomePage'

// Club and event pages are code-split per route so the auth/home entry stays
// light. AppLayout, ClubLayout and EventLayout provide the Suspense boundaries,
// keeping each shell (topbar, club/event header, tabs) mounted while a chunk loads.
const ClubCreatePage = lazy(() =>
  import('./pages/clubs/ClubCreatePage').then((m) => ({ default: m.ClubCreatePage })),
)
const ClubLayout = lazy(() =>
  import('./pages/clubs/ClubLayout').then((m) => ({ default: m.ClubLayout })),
)
const ClubOverviewPage = lazy(() =>
  import('./pages/clubs/ClubOverviewPage').then((m) => ({ default: m.ClubOverviewPage })),
)
const ClubEventsPage = lazy(() =>
  import('./pages/clubs/ClubEventsPage').then((m) => ({ default: m.ClubEventsPage })),
)
const ClubMembersPage = lazy(() =>
  import('./pages/clubs/ClubMembersPage').then((m) => ({ default: m.ClubMembersPage })),
)
const ClubSettingsPage = lazy(() =>
  import('./pages/clubs/ClubSettingsPage').then((m) => ({ default: m.ClubSettingsPage })),
)
const EventCreatePage = lazy(() =>
  import('./pages/events/EventCreatePage').then((m) => ({ default: m.EventCreatePage })),
)
const EventCreateRedirect = lazy(() =>
  import('./pages/events/EventCreateRedirect').then((m) => ({ default: m.EventCreateRedirect })),
)
const EventLayout = lazy(() =>
  import('./pages/events/EventLayout').then((m) => ({ default: m.EventLayout })),
)
const OverviewPage = lazy(() =>
  import('./pages/events/OverviewPage').then((m) => ({ default: m.OverviewPage })),
)
const LeaderboardPage = lazy(() =>
  import('./pages/events/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })),
)
const DashboardPage = lazy(() =>
  import('./pages/events/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const ScanPage = lazy(() =>
  import('./pages/events/ScanPage').then((m) => ({ default: m.ScanPage })),
)
const ActivitiesPage = lazy(() =>
  import('./pages/events/ActivitiesPage').then((m) => ({ default: m.ActivitiesPage })),
)
const MembersPage = lazy(() =>
  import('./pages/events/MembersPage').then((m) => ({ default: m.MembersPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/events/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const PublicLeaderboardPage = lazy(() =>
  import('./pages/public/PublicLeaderboardPage').then((m) => ({ default: m.PublicLeaderboardPage })),
)

function SetupScreen() {
  return (
    <div className="setup-screen">
      <h1>EMP — Event Management Platform</h1>
      <p>Supabase is not configured yet.</p>
      <ol>
        <li>Create a Supabase project and run <code>supabase/migrations/00001_init.sql</code>.</li>
        <li>Copy <code>.env.example</code> to <code>.env</code> and fill in
          <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.</li>
        <li>Restart <code>npm run dev</code>.</li>
      </ol>
    </div>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupScreen />

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* public, anonymous leaderboard — outside AppLayout, needs its own boundary */}
          <Route
            path="/e/:slug/leaderboard"
            element={
              <Suspense fallback={<div className="page-loading">Loading…</div>}>
                <PublicLeaderboardPage />
              </Suspense>
            }
          />

          <Route element={<AppLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/" element={<HomePage />} />

              {/* club-first flow: clubs contain events */}
              <Route path="/clubs/new" element={<ClubCreatePage />} />
              <Route path="/clubs/:clubId" element={<ClubLayout />}>
                <Route index element={<ClubOverviewPage />} />
                <Route path="events" element={<ClubEventsPage />} />
                <Route path="events/new" element={<EventCreatePage />} />
                <Route path="members" element={<ClubMembersPage />} />
                <Route path="settings" element={<ClubSettingsPage />} />
              </Route>

              {/* legacy event-first entry point — routes into the club-first flow
                  instead of creating a club-less event */}
              <Route path="/events/new" element={<EventCreateRedirect />} />

              <Route path="/events/:eventId" element={<EventLayout />}>
                <Route index element={<OverviewPage />} />
                <Route path="leaderboard" element={<LeaderboardPage />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="scan" element={<ScanPage />} />
                <Route path="activities" element={<ActivitiesPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
