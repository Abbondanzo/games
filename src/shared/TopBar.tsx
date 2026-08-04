import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The bar every page but the home page carries.
 *
 * It exists mostly for the back link. Installed as an app there is no browser
 * chrome to fall back on, so a page without one is a page you cannot leave -
 * which is what happened to the join page, where the only way out was to force
 * quit. Making the bar a component means a new page gets the way out by
 * default rather than by remembering.
 */
interface Props {
  title: string;
  /** Controls for the right-hand side, if this page has any. */
  children?: ReactNode;
}

export function TopBar({ title, children }: Props) {
  return (
    <header className="topbar">
      <Link className="back" to="/" aria-label="All games">
        <ArrowLeft size={20} aria-hidden="true" />
      </Link>
      <h1>{title}</h1>
      {children !== undefined && <div className="topbar-actions">{children}</div>}
    </header>
  );
}
