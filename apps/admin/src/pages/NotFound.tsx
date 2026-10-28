import { Link } from 'react-router';

import { PageHead } from '../components/ui';

export function NotFoundPage() {
  return (
    <>
      <PageHead title="Not found" />
      <p>
        There&apos;s no admin page here. <Link to="/">Overview</Link>
      </p>
    </>
  );
}
