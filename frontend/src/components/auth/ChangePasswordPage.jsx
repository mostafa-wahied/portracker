import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Shield } from 'lucide-react';
import Logo from '@/components/Logo';
import { useAuth } from '@/contexts/AuthContext';

export function ChangePasswordPage() {
  const { changePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    const result = await changePassword(null, newPassword);

    if (!result.success) {
      setError(result.error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="relative group mb-4">
              <Logo size="lg" className="transition-transform duration-300 group-hover:rotate-[30deg]" />
              <div className="absolute -top-1 -right-1 bg-amber-500 text-white rounded-full p-1.5 shadow-lg transform transition-transform duration-300 group-hover:scale-110">
                <Shield className="w-4 h-4" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Password Change Required
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Set a new secure password to continue
            </p>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 mb-6">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Recovery mode was used. You must set a new password before accessing the application.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('At least 8 characters')}
                required
                autoComplete="new-password"
                disabled={loading}
                autoFocus
              />
              {newPassword && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {newPassword.length >= 8 ? (
                    <span className="text-green-600 dark:text-green-400">✓ Valid password</span>
                  ) : (
                    <span>At least 8 characters required</span>
                  )}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('Confirm Password')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('Re-enter new password')}
                required
                autoComplete="new-password"
                disabled={loading}
              />
              {confirmPassword && (
                <p className="text-xs">
                  {newPassword === confirmPassword ? (
                    <span className="text-green-600 dark:text-green-400">✓ Passwords match</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">✗ Passwords do not match</span>
                  )}
                </p>
              )}
            </div>

            {error && (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || newPassword.length < 8 || newPassword !== confirmPassword}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {loading ? 'Changing Password...' : 'Set New Password'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
