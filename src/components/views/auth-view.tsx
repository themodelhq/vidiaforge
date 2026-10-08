'use client';

import { useState } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Lock,
  User,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { ViewName } from '@/lib/types';

interface AuthViewProps {
  mode: 'login' | 'register';
}

interface AuthResponse {
  user?: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    plan: string;
    createdAt: string;
  };
  error?: string;
  code?: string;
}

async function parseAuthResponse(
  response: Response,
): Promise<AuthResponse> {
  const contentType =
    response.headers.get('content-type') ?? '';

  const text = await response.text();

  // Never call response.json() blindly.
  //
  // An empty response is the direct cause of:
  //
  //   Unexpected end of JSON input
  //
  if (!text.trim()) {
    throw new Error(
      response.ok
        ? 'The authentication service returned an empty response.'
        : `The authentication service returned an empty response (HTTP ${response.status}).`,
    );
  }

  // JSON responses should have a JSON content type.
  //
  // We still attempt JSON.parse() below because some proxies may
  // incorrectly omit the content-type header.
  let data: AuthResponse;

  try {
    data = JSON.parse(text) as AuthResponse;
  } catch {
    const preview = text
      .replace(/\s+/g, ' ')
      .slice(0, 180);

    if (response.status >= 500) {
      throw new Error(
        `The authentication service is temporarily unavailable (HTTP ${response.status}).`,
      );
    }

    if (
      contentType.includes('text/html')
    ) {
      throw new Error(
        'The authentication service returned an unexpected HTML response. Please check the Render API and Netlify API proxy configuration.',
      );
    }

    throw new Error(
      `The authentication service returned an invalid response (HTTP ${response.status}).${preview ? ` ${preview}` : ''}`,
    );
  }

  return data;
}

function getFriendlyAuthError(
  status: number,
  data: AuthResponse,
): string {
  if (
    typeof data.error === 'string' &&
    data.error.trim()
  ) {
    return data.error;
  }

  switch (status) {
    case 400:
      return 'Please check the information you entered.';

    case 401:
      return 'Invalid email or password.';

    case 409:
      return 'An account with this email already exists.';

    case 429:
      return 'Too many attempts. Please wait a moment and try again.';

    case 500:
      return 'The authentication service encountered an unexpected error.';

    case 503:
      return 'The authentication service is temporarily unavailable. Please try again shortly.';

    default:
      return `Authentication failed (HTTP ${status}).`;
  }
}

export function AuthView({
  mode,
}: AuthViewProps) {
  const setView = useUIStore(
    (s) => s.setView,
  );

  const setUser = useAuthStore(
    (s) => s.setUser,
  );

  const refresh = useAuthStore(
    (s) => s.refresh,
  );

  const [email, setEmail] =
    useState('');

  const [password, setPassword] =
    useState('');

  const [name, setName] =
    useState('');

  const [showPassword, setShowPassword] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const isRegister =
    mode === 'register';

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();

    setError(null);

    const normalizedEmail =
      email.trim().toLowerCase();

    const normalizedName =
      name.trim();

    // -------------------------------------------------------------------------
    // Client-side validation
    // -------------------------------------------------------------------------

    if (
      !normalizedEmail ||
      !normalizedEmail.includes('@')
    ) {
      setError(
        'Please enter a valid email address.',
      );
      return;
    }

    if (
      password.length <
      (isRegister ? 8 : 1)
    ) {
      setError(
        isRegister
          ? 'Password must be at least 8 characters.'
          : 'Please enter your password.',
      );
      return;
    }

    setLoading(true);

    try {
      // -----------------------------------------------------------------------
      // Authentication endpoint
      // -----------------------------------------------------------------------

      const endpoint = isRegister
        ? '/api/auth/register'
        : '/api/auth/login';

      const body = isRegister
        ? {
            email: normalizedEmail,
            password,
            name:
              normalizedName ||
              undefined,
          }
        : {
            email: normalizedEmail,
            password,
          };

      // -----------------------------------------------------------------------
      // API request
      // -----------------------------------------------------------------------

      let response: Response;

      try {
        response = await fetch(
          endpoint,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type':
                'application/json',
              Accept:
                'application/json',
            },
            cache: 'no-store',
            body: JSON.stringify(body),
          },
        );
      } catch (networkError) {
        throw new Error(
          'Unable to reach the authentication service. Please check your internet connection and try again.',
        );
      }

      // -----------------------------------------------------------------------
      // Parse response safely
      // -----------------------------------------------------------------------

      const data =
        await parseAuthResponse(response);

      // -----------------------------------------------------------------------
      // HTTP failure
      // -----------------------------------------------------------------------

      if (!response.ok) {
        throw new Error(
          getFriendlyAuthError(
            response.status,
            data,
          ),
        );
      }

      // -----------------------------------------------------------------------
      // Successful authentication must contain a user
      // -----------------------------------------------------------------------

      if (!data.user) {
        throw new Error(
          'Authentication succeeded, but the server did not return a user session. Please try again.',
        );
      }

      // -----------------------------------------------------------------------
      // Immediately update the client auth state.
      //
      // This avoids depending exclusively on a second /api/auth/me request
      // immediately after registration/login.
      // -----------------------------------------------------------------------

      setUser(data.user);

      // -----------------------------------------------------------------------
      // Refresh the session from the server as a secondary verification.
      //
      // If the refresh request fails because the deployment proxy is temporarily
      // unavailable, we do NOT discard the successful authentication response.
      // -----------------------------------------------------------------------

      try {
        await refresh();
      } catch {
        // The authentication response already contained the authenticated user.
        // Keep that state rather than converting a successful login into an error.
        setUser(data.user);
      }

      toast.success(
        isRegister
          ? 'Welcome to VidiaForge!'
          : 'Welcome back!',
      );

      setView('dashboard');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Something went wrong while contacting the authentication service.';

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />

      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />

      <div className="relative z-10 min-h-screen w-full grid lg:grid-cols-2">
        {/* ------------------------------------------------------------------ */}
        {/* Left: brand panel                                                  */}
        {/* ------------------------------------------------------------------ */}

        <div className="hidden lg:flex flex-col justify-between p-12 border-r border-border/50">
          <button
            type="button"
            onClick={() =>
              setView('landing')
            }
            className="flex items-center gap-2.5 group w-fit"
          >
            <div className="relative h-9 w-9 rounded-lg overflow-hidden ring-1 ring-primary/30">
              <svg
                viewBox="0 0 512 512"
                className="h-full w-full"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient
                    id="bgl"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="#f5a623"
                    />
                    <stop
                      offset="100%"
                      stopColor="#e07b1a"
                    />
                  </linearGradient>
                </defs>

                <rect
                  width="512"
                  height="512"
                  fill="#0a0a0f"
                />

                <circle
                  cx="256"
                  cy="256"
                  r="140"
                  fill="none"
                  stroke="url(#bgl)"
                  strokeWidth="14"
                  opacity="0.9"
                />

                <path
                  d="M 204 178 L 348 256 L 204 334 Z"
                  fill="url(#bgl)"
                />
              </svg>
            </div>

            <span className="text-lg font-semibold tracking-tight">
              VidiaForge
            </span>
          </button>

          <div className="space-y-6 max-w-md">
            <h2 className="text-4xl font-semibold tracking-tight leading-tight">
              Professional video editing,{' '}
              <span className="text-gradient-cinematic">
                right in your browser.
              </span>
            </h2>

            <p className="text-muted-foreground text-base leading-relaxed">
              A real timeline. Real effects. AI captions. Color grading. One-click exports for every platform.
              No download. No watermark on your creative vision.
            </p>

            <ul className="space-y-3">
              {[
                {
                  icon: ShieldCheck,
                  text: 'Non-destructive editing — your originals are never touched',
                },
                {
                  icon: Sparkles,
                  text: 'AI assistant: silence removal, captions, highlights, reframing',
                },
                {
                  icon: Mail,
                  text: 'Works on desktop, tablet, and mobile — installable as a PWA',
                },
              ].map(
                ({
                  icon: Icon,
                  text,
                }, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 text-sm text-muted-foreground"
                  >
                    <Icon className="h-4.5 w-4.5 text-primary mt-0.5 shrink-0" />
                    <span>
                      {text}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            © 2025 VidiaForge. Crafted for creators.
          </p>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Right: authentication form                                         */}
        {/* ------------------------------------------------------------------ */}

        <div className="flex flex-col items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-md">
            <button
              type="button"
              onClick={() =>
                setView('landing')
              }
              className="lg:hidden flex items-center gap-2 mb-8 text-sm text-muted-foreground hover:text-foreground transition"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </button>

            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-2.5 mb-8">
              <div className="h-9 w-9 rounded-lg overflow-hidden ring-1 ring-primary/30">
                <svg
                  viewBox="0 0 512 512"
                  className="h-full w-full"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient
                      id="bgm"
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#f5a623"
                      />
                      <stop
                        offset="100%"
                        stopColor="#e07b1a"
                      />
                    </linearGradient>
                  </defs>

                  <rect
                    width="512"
                    height="512"
                    fill="#0a0a0f"
                  />

                  <circle
                    cx="256"
                    cy="256"
                    r="140"
                    fill="none"
                    stroke="url(#bgm)"
                    strokeWidth="14"
                    opacity="0.9"
                  />

                  <path
                    d="M 204 178 L 348 256 L 204 334 Z"
                    fill="url(#bgm)"
                  />
                </svg>
              </div>

              <span className="text-lg font-semibold tracking-tight">
                VidiaForge
              </span>
            </div>

            <div className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight">
                {isRegister
                  ? 'Create your account'
                  : 'Welcome back'}
              </h1>

              <p className="text-sm text-muted-foreground mt-1.5">
                {isRegister
                  ? 'Start editing in seconds. No credit card required.'
                  : 'Sign in to continue to your studio.'}
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-4"
              noValidate
            >
              {/* Display name */}
              {isRegister && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">
                    Display name{' '}
                    <span className="text-muted-foreground">
                      (optional)
                    </span>
                  </Label>

                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

                    <Input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) =>
                        setName(
                          e.target.value,
                        )
                      }
                      placeholder="Jane Director"
                      className="pl-9 bg-card/60 border-border/60"
                      autoComplete="name"
                      maxLength={100}
                      disabled={loading}
                    />
                  </div>
                </div>
              )}

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email">
                  Email
                </Label>

                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) =>
                      setEmail(
                        e.target.value,
                      )
                    }
                    placeholder="you@studio.com"
                    className="pl-9 bg-card/60 border-border/60"
                    autoComplete="email"
                    disabled={loading}
                    maxLength={254}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">
                    Password
                  </Label>

                  {!isRegister && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-primary transition"
                      onClick={() =>
                        toast.info(
                          'Password reset will be available soon.',
                        )
                      }
                      disabled={loading}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>

                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

                  <Input
                    id="password"
                    type={
                      showPassword
                        ? 'text'
                        : 'password'
                    }
                    required
                    value={password}
                    onChange={(e) =>
                      setPassword(
                        e.target.value,
                      )
                    }
                    placeholder={
                      isRegister
                        ? 'At least 8 characters'
                        : '••••••••'
                    }
                    className="pl-9 pr-9 bg-card/60 border-border/60"
                    autoComplete={
                      isRegister
                        ? 'new-password'
                        : 'current-password'
                    }
                    disabled={loading}
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword(
                        (s) => !s,
                      )
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                    aria-label={
                      showPassword
                        ? 'Hide password'
                        : 'Show password'
                    }
                    disabled={loading}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {isRegister &&
                  password.length > 0 &&
                  password.length < 8 && (
                    <p className="text-xs text-amber-500/80">
                      Use 8 or more
                      characters.
                    </p>
                  )}
              </div>

              {/* Error */}
              {error && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </div>
              )}

              {/* Submit */}
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-10 text-sm font-medium"
                size="lg"
              >
                {loading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}

                {isRegister
                  ? 'Create account'
                  : 'Sign in'}
              </Button>
            </form>

            {/* Divider */}
            <div className="my-6 flex items-center gap-3">
              <Separator className="flex-1" />

              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                or
              </span>

              <Separator className="flex-1" />
            </div>

            {/* Social authentication */}
            <div className="grid grid-cols-1 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 bg-card/40"
                onClick={() =>
                  toast.info(
                    'Google sign-in is architecture-ready and will be enabled soon.',
                  )
                }
                disabled={loading}
              >
                <GoogleIcon className="h-4 w-4 mr-2" />
                Continue with Google
              </Button>

              <Button
                type="button"
                variant="outline"
                className="h-10 bg-card/40"
                onClick={() =>
                  toast.info(
                    'Apple sign-in is architecture-ready and will be enabled soon.',
                  )
                }
                disabled={loading}
              >
                <AppleIcon className="h-4 w-4 mr-2" />
                Continue with Apple
              </Button>
            </div>

            {/* Switch auth mode */}
            <p className="mt-8 text-center text-sm text-muted-foreground">
              {isRegister
                ? 'Already have an account?'
                : "Don't have an account?"}{' '}

              <button
                type="button"
                onClick={() =>
                  setView(
                    (isRegister
                      ? 'login'
                      : 'register') as ViewName,
                  )
                }
                className="text-primary hover:underline font-medium"
                disabled={loading}
              >
                {isRegister
                  ? 'Sign in'
                  : 'Create one free'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />

      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />

      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />

      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AppleIcon({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}