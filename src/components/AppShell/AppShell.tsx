import { Suspense, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { BottomNav } from '@/components/BottomNav/BottomNav';
import { useAlertScheduler } from '@/lib/alerts/useAlertScheduler';
import { fileAlerts, markRead } from '@/data/alertInboxStore';
import { onNotificationTap } from '@/lib/alerts/notificationScheduler';

/**
 * Runs the alert engine for the whole session, not just while the Inbox is open.
 *
 * fileAlerts() and useAlertScheduler() were both mounted only inside the Inbox
 * screen, so nothing was filed and no OS notification was queued unless the
 * user was already looking at the Inbox. The header bell counts items in the
 * store, so on a cold open it rendered unbadged no matter what the engines
 * would have said — the app's one proactive surface could only be discovered by
 * someone who had already gone looking for it.
 *
 * Living at shell level, this runs under every route. The Inbox becomes a pure
 * reader of the store, which is what it always described itself as: "findings
 * that arrived while you were not looking".
 */
function AlertEnginePump() {
  const { alerts } = useAlertScheduler();
  useEffect(() => {
    if (alerts.length > 0) fileAlerts(alerts);
  }, [alerts]);
  return null;
}

/**
 * A tapped notification opens the screen it is about: a heads-up or a morning
 * report lands on that weekday's hours rather than on whatever screen the app
 * was last left on. Only in-app paths are followed.
 */
function NotificationTapRouter() {
  const navigate = useNavigate();
  useEffect(
    () =>
      onNotificationTap(({ alertId, route }) => {
        if (alertId) markRead(alertId);
        if (route?.startsWith('/app/')) navigate(route);
      }),
    [navigate],
  );
  return null;
}

export function AppShell() {
  return (
    <div className="app-container">
      <AlertEnginePump />
      <NotificationTapRouter />
      {/* Screens other than Trends load on first visit (App.tsx). The
          fallback is blank on purpose: a chunk from local app storage
          arrives in a frame or two, and a spinner would only flash. */}
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
      <BottomNav />
    </div>
  );
}
