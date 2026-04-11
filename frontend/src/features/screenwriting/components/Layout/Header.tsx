import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Scissors, User, Key, LogOut, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { APP_NAME, ROUTES } from '../../lib/constants';
import { ModeToggle } from './ModeToggle';

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleLogout() {
    localStorage.removeItem('token');
    navigate('/login');
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
      >
        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
          <User className="h-3.5 w-3.5" />
        </div>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-48 rounded-lg border border-border/60 bg-popover shadow-lg z-50 py-1">
          <Link
            to={ROUTES.PROFILE}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
          >
            <User className="h-4 w-4 text-muted-foreground" />
            Profile
          </Link>
          <Link
            to={ROUTES.API_KEYS}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
          >
            <Key className="h-4 w-4 text-muted-foreground" />
            API Keys
          </Link>
          <div className="my-1 border-t border-border/60" />
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-muted/60 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-screen-2xl px-6">
        <div className="flex h-14 items-center gap-4">
          {/* Logo — left */}
          <Link to={ROUTES.HOME} className="flex items-center gap-2.5 group flex-shrink-0">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 shadow-md shadow-amber-900/20 transition-shadow group-hover:shadow-amber-800/30">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-amber-50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </div>
            <span className="font-display text-lg font-semibold tracking-tight text-foreground">
              {APP_NAME}
            </span>
          </Link>

          {/* Mode Toggle — center */}
          <ModeToggle />

          {/* Navigation — right, pushed to end */}
          <nav className="flex items-center gap-1 ml-auto">
            <Link
              to={ROUTES.PROJECTS}
              className={`relative px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors
                ${isActive('/projects') || isActive('/')
                  ? 'text-foreground bg-muted/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
            >
              Projects
            </Link>
            <Link
              to={ROUTES.BOOKS}
              className={`relative flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors
                ${isActive('/books')
                  ? 'text-foreground bg-muted/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Books
            </Link>
            <Link
              to={ROUTES.SNIPPETS}
              className={`relative flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors
                ${isActive('/snippets')
                  ? 'text-foreground bg-muted/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
            >
              <Scissors className="h-3.5 w-3.5" />
              Snippets
            </Link>
            <UserMenu />
          </nav>
        </div>
      </div>
    </header>
  );
}
