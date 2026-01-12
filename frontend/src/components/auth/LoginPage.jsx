import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';
import Logo from '@/components/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { SetupWizard } from './SetupWizard';

export function LoginPage() {
  const { authEnabled, setupRequired, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordInputRef = useRef(null);

  useEffect(() => {
    if (error && passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  }, [error]);

  if (!authEnabled) {
    return null;
  }

  if (setupRequired) {
    return <SetupWizard />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(username.trim(), password);

    if (!result.success) {
      setError(result.error);
      setPassword('');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-800 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="mb-4 group">
              <Logo className="w-20 h-20 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all duration-300 ease-in-out group-hover:rotate-[30deg]" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              portracker
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {t('Sign in to continue')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-slate-700 dark:text-slate-300">{t('Username')}</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('Enter your username')}
                required
                autoComplete="username"
                disabled={loading}
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-700 dark:text-slate-300">{t('Password')}</Label>
              <Input
                ref={passwordInputRef}
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('Enter your password')}
                required
                autoComplete="current-password"
                disabled={loading}
                className="h-10"
              />
            </div>

            {error && (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                <p className="text-sm text-red-800 dark:text-red-200">
                  {error}
                </p>
              </div>
            )}

              <Button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {loading ? t('Signing in...') : t('Sign In')}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              portracker &copy; {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
