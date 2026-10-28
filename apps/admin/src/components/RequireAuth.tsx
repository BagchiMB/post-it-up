import { Navigate, useLocation } from 'react-router';

import { ApiError } from '../api/client';
import { useSession } from '../api/queries';
import { Shell } from './Shell';
import { ErrorBox, SkeletonCards } from './ui';

/** Every page except sign-in needs a session; without one, go to /login?next=<here>. */
export function RequireAuth() {
  const session = useSession();
  const { pathname, search } = useLocation();
  if (session.error instanceof ApiError && session.error.status === 401) {
    const next =
      pathname === '/' && !search ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return <Navigate to={`/login${next}`} replace />;
  }
  if (session.isPending) {
    return (
      <div className="login-wrap" aria-busy="true">
        <div style={{ width: 'min(720px, 100%)' }}>
          <SkeletonCards />
        </div>
      </div>
    );
  }
  if (session.error) {
    return (
      <div className="login-wrap">
        <div className="login">
          <ErrorBox error={session.error} />
          <button type="button" onClick={() => void session.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  return <Shell />;
}
