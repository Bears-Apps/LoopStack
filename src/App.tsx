import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/AppShell/AppShell';
import { DataSourceProvider } from '@/data/sources/DataSourceContext';
import { TrendsHome } from '@/screens/TrendsHome/TrendsHome';

// Trends is where the app opens, so it ships in the first bundle. Every other
// screen loads the first time it is visited: the app used to parse every
// screen's code before showing Trends, most of it for screens opened once a
// week. AppShell's Suspense boundary covers the moment of loading.
function screen<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
const Login = screen(() => import('@/screens/Login/Login'), 'Login');
const Insights = screen(() => import('@/screens/Insights/Insights'), 'Insights');
const FixLog = screen(() => import('@/screens/FixLog/FixLog'), 'FixLog');
const CommitLog = screen(() => import('@/screens/CommitLog/CommitLog'), 'CommitLog');
const Profile = screen(() => import('@/screens/Profile/Profile'), 'Profile');
const SourcesSettings = screen(() => import('@/screens/SourcesSettings/SourcesSettings'), 'SourcesSettings');
const Inbox = screen(() => import('@/screens/Inbox/Inbox'), 'Inbox');
const DataChat = screen(() => import('@/screens/DataChat/DataChat'), 'DataChat');
const ClinicReport = screen(() => import('@/screens/ClinicReport/ClinicReport'), 'ClinicReport');
const ClaudeSettings = screen(() => import('@/screens/ClaudeSettings/ClaudeSettings'), 'ClaudeSettings');
const WeekdayHours = screen(() => import('@/screens/WeekdayHours/WeekdayHours'), 'WeekdayHours');

const router = createBrowserRouter([
  // Personal-tool default — open straight into the logged-in experience.
  // /welcome is still reachable for the onboarding/login surface.
  { path: '/', element: <Navigate to="/app/trends" replace /> },
  {
    path: '/welcome',
    element: (
      <Suspense fallback={null}>
        <Login />
      </Suspense>
    ),
  },
  {
    path: '/app',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/app/trends" replace /> },
      { path: 'trends', element: <TrendsHome /> },
      { path: 'insights', element: <Insights /> },
      { path: 'patterns', element: <Navigate to="/app/insights" replace /> },
      { path: 'fixlog', element: <FixLog /> },
      { path: 'commitlog', element: <CommitLog /> },
      { path: 'profile', element: <Profile /> },
      { path: 'settings/sources', element: <SourcesSettings /> },
      { path: 'inbox', element: <Inbox /> },
      { path: 'chat', element: <DataChat /> },
      { path: 'report', element: <ClinicReport /> },
      { path: 'settings/claude', element: <ClaudeSettings /> },
      { path: 'weekday', element: <WeekdayHours /> },
      // The meal tools were removed; old links land on Trends instead of a blank page.
      { path: 'memories', element: <Navigate to="/app/trends" replace /> },
      { path: 'capture', element: <Navigate to="/app/trends" replace /> },
      { path: 'carbcalc', element: <Navigate to="/app/trends" replace /> },
    ],
  },
  { path: '/trends', element: <Navigate to="/app/trends" replace /> },
  { path: '/memories', element: <Navigate to="/app/trends" replace /> },
  { path: '/insights', element: <Navigate to="/app/insights" replace /> },
  { path: '/patterns', element: <Navigate to="/app/insights" replace /> },
  { path: '/fixlog', element: <Navigate to="/app/fixlog" replace /> },
  { path: '/commitlog', element: <Navigate to="/app/commitlog" replace /> },
  { path: '/profile', element: <Navigate to="/app/profile" replace /> },
  { path: '/capture', element: <Navigate to="/app/trends" replace /> },
  { path: '/carbcalc', element: <Navigate to="/app/trends" replace /> },
  { path: '/inbox', element: <Navigate to="/app/inbox" replace /> },
]);

export function App() {
  return (
    <DataSourceProvider>
      <RouterProvider router={router} />
    </DataSourceProvider>
  );
}
