import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle } from 'lucide-react';
import { t } from '@/lib/i18n';

export function ChangePasswordModal({ open, onClose, requirePasswordChange = false }) {
  const [currentPassword, setCurrentPassword] = useState('');
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

    try {
      const body = requirePasswordChange
        ? { newPassword }
        : { currentPassword, newPassword };

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || t('Password change failed'));
        setLoading(false);
        return;
      }

      onClose(true);
    } catch (error) {
      setError(error.message || 'Network error');
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={requirePasswordChange ? undefined : onClose}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => requirePasswordChange && e.preventDefault()}>
        <DialogHeader>
              <DialogTitle>
                {requirePasswordChange ? t('Set New Password') : t('Change Password')}
              </DialogTitle>
          <DialogDescription>
                {requirePasswordChange
                  ? t('You must set a new password to continue')
                  : t('Update your account password')}
          </DialogDescription>
        </DialogHeader>

        {requirePasswordChange && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {t('Recovery mode was used. Please set a new secure password.')}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!requirePasswordChange && (
            <div className="space-y-2">
              <Label htmlFor="currentPassword">{t('Current Password')}</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t('Enter current password')}
                required
                autoComplete="current-password"
                disabled={loading}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="newPassword">{t('New Password')}</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('At least 8 characters')}
              required
              autoComplete="new-password"
              disabled={loading}
            />
            {newPassword && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {newPassword.length >= 8 ? (
                  <span className="text-green-600 dark:text-green-400">✓ {t('Valid password')}</span>
                ) : (
                  <span>At least 8 characters required</span>
                )}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t('Confirm New Password')}</Label>
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
                  <span className="text-green-600 dark:text-green-400">✓ {t('Passwords match')}</span>
                ) : (
                  <span className="text-red-600 dark:text-red-400">✗ {t('Passwords do not match')}</span>
                )}
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            {!requirePasswordChange && (
              <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={loading}>
                {t('Cancel')}
              </Button>
            )}
            <Button
              type="submit"
              disabled={loading || newPassword.length < 8 || newPassword !== confirmPassword}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {loading ? t('Changing...') : t('Change Password')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
