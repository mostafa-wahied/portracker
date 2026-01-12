import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Logo from '@/components/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { t } from '@/lib/i18n';

export function SetupWizard() {
  const { setup } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    const result = await setup(username.trim(), password);

    if (!result.success) {
      setError(result.error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-lg">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-800 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="mb-4 relative group">
              <Logo className="w-20 h-20 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all duration-300 ease-in-out group-hover:rotate-[30deg]" />
              <div className="absolute -bottom-1 -right-1 bg-indigo-600 rounded-full p-2 shadow-lg transition-all duration-300 ease-in-out group-hover:scale-110">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {t('Welcome to portracker')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 text-center">
              {t('Create your admin account to secure your instance')}
            </p>
          </div>

          <div className="mb-6 p-4 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900">
            <div className="flex items-start gap-3">
              <KeyRound className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-indigo-900 dark:text-indigo-100 text-sm">
                  {t('First-Time Setup')}
                </h3>
                <p className="text-sm text-indigo-700 dark:text-indigo-300 mt-1">
                  {t('Choose a strong password. This account will have full access to your portracker instance.')}
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-slate-700 dark:text-slate-300">{t('Admin Username')}</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('Admin username')}
                required
                autoComplete="username"
                disabled={loading}
                className="h-10"
              />
              {username && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {username.length >= 3 ? (
                    <span className="text-green-600 dark:text-green-400">✓ {t('Valid username')}</span>
                  ) : (
                    <span>At least 3 characters required</span>
                  )}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-700 dark:text-slate-300">{t('Password')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('Password')}
                required
                autoComplete="new-password"
                disabled={loading}
                className="h-10"
              />
              {password && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {password.length >= 8 ? (
                    <span className="text-green-600 dark:text-green-400">✓ {t('Valid password')}</span>
                  ) : (
                    <span>At least 8 characters required</span>
                  )}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-slate-700 dark:text-slate-300">{t('Confirm Password')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('Confirm password')}
                required
                autoComplete="new-password"
                disabled={loading}
                className="h-10"
              />
              {confirmPassword && (
                <p className="text-xs">
                  {password === confirmPassword ? (
                    <span className="text-green-600 dark:text-green-400">✓ {t('Passwords match')}</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">✗ {t('Passwords do not match')}</span>
                  )}
                </p>
              )}
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
              disabled={loading || username.length < 3 || password.length < 8 || password !== confirmPassword}
              className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {loading ? t('Creating Account...') : t('Create Admin Account')}
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
