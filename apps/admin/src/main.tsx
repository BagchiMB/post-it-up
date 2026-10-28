import './styles/tokens.css';
import './styles/components.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { setUnauthorizedHandler } from './api/client';
import { queryClient } from './api/queries';
import { router } from './router';

// Any 401 from the API (session expired, signed out elsewhere) → sign-in page, keeping ?next=.
setUnauthorizedHandler(() => {
  const { pathname, search } = router.state.location;
  if (pathname === '/login') return;
  queryClient.clear();
  void router.navigate(`/login?next=${encodeURIComponent(pathname + search)}`, { replace: true });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
