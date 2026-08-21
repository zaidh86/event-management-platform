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
const ProjectorPage = lazy(() =>
  import('./pages/public/ProjectorPage').then((m) => ({ default: m.ProjectorPage })),
)
const PublicQrPage = lazy(() =>
  import('./pages/public/PublicQrPage').then((m) => ({ default: m.PublicQrPage })),
)
const FeedbackFillPage = lazy(() =>
  import('./pages/public/FeedbackFillPage').then((m) => ({ default: m.FeedbackFillPage })),
)
const FeedbackPage = lazy(() =>
  import('./pages/events/FeedbackPage').then((m) => ({ default: m.FeedbackPage })),
)
const AnalyticsPage = lazy(() =>
  import('./pages/events/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
)
const ReportPage = lazy(() =>
  import('./pages/events/ReportPage').then((m) => ({ default: m.ReportPage })),
)
const CertificatesPage = lazy(() =>
  import('./pages/events/CertificatesPage').then((m) => ({ default: m.CertificatesPage })),
)
const CertificateVerifyPage = lazy(() =>
  import('./pages/public/CertificateVerifyPage').then((m) => ({ default: m.CertificateVerifyPage })),
)
const ForgotPasswordPage = lazy(() =>
  import('./pages/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
)
const ResetPasswordPage = lazy(() =>
  import('./pages/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
)
const JudgingPage = lazy(() =>
  import('./pages/events/JudgingPage').then((m) => ({ default: m.JudgingPage })),
)
const AccountSettingsPage = lazy(() =>
  import('./pages/settings/AccountSettingsPage').then((m) => ({ default: m.AccountSettingsPage })),
)
const PlatformAdminPage = lazy(() =>
  import('./pages/settings/PlatformAdminPage').then((m) => ({ default: m.PlatformAdminPage })),
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

          {/* projector mode — venue display, same access rules as the leaderboard */}
          <Route
            path="/e/:slug/projector"
            element={
              <Suspense fallback={<div className="page-loading">Loading…</div>}>
                <ProjectorPage />
              </Suspense>
            }
          />
          {/* scanned event/feedback QR landing (poster QRs encode /q/:token) */}
          <Route
            path="/q/:token"
            element={
              <Suspense fallback={<div className="page-loading">Loading…</div>}>
                <PublicQrPage />
              </Suspense>
            }
          />
          {/* public certificate verification (print-ready) */}
          <Route
            path="/cert/:code"
            element={
              <Suspense fallback={<div className="page-loading">Loading…</div>}>
                <CertificateVerifyPage />
              </Suspense>
            }
          />
          {/* respondent-facing feedback form (public or participants) */}
          <Route
            path="/f/:formId"
            element={
              <Suspense fallback={<div className="page-loading">Loading…</div>}>
                <FeedbackFillPage />
              </Suspense>
            }
          />

          <Route element={<AppLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* PUBLIC-FIRST BROWSING: home, clubs and events are browsable
                signed-out (anon RLS scopes the data; 00019). Authentication is
                requested only when an action needs an account — pages behind
                role/participant gates render their own refusals. */}
            <Route path="/" element={<HomePage />} />
            <Route path="/clubs/:clubId" element={<ClubLayout />}>
              <Route index element={<ClubOverviewPage />} />
              <Route path="events" element={<ClubEventsPage />} />
              {/* club management stays signed-in only */}
              <Route element={<RequireAuth />}>
                <Route path="events/new" element={<EventCreatePage />} />
                <Route path="members" element={<ClubMembersPage />} />
                <Route path="settings" element={<ClubSettingsPage />} />
              </Route>
            </Route>
            <Route path="/events/:eventId" element={<EventLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="leaderboard" element={<LeaderboardPage />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="scan" element={<ScanPage />} />
              <Route path="activities" element={<ActivitiesPage />} />
              <Route path="feedback" element={<FeedbackPage />} />
              <Route path="judging" element={<JudgingPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="report" element={<ReportPage />} />
              <Route path="certificates" element={<CertificatesPage />} />
              <Route path="members" element={<MembersPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>

            <Route element={<RequireAuth />}>
              <Route path="/settings" element={<AccountSettingsPage />} />
              <Route path="/admin" element={<PlatformAdminPage />} />
              <Route path="/clubs/new" element={<ClubCreatePage />} />
              {/* legacy event-first entry point — routes into the club-first flow
                  instead of creating a club-less event */}
              <Route path="/events/new" element={<EventCreateRedirect />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
