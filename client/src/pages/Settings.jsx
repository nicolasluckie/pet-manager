import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { patch, post, TOKEN_KEY } from '../api/client.js';
import { storage } from '../lib/storage.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useErrorMessage } from '../lib/useErrorMessage.js';
import PageHeader from '../components/PageHeader.jsx';
import Section from '../components/Section.jsx';
import ThemePicker from '../components/ThemePicker.jsx';
import LanguagePicker from '../components/LanguagePicker.jsx';
import HouseholdSection from './settings/HouseholdSection.jsx';
import SiteIconSection from './settings/SiteIconSection.jsx';
import NotificationsSection from './settings/NotificationsSection.jsx';

export default function Settings() {
  const { t } = useTranslation();
  const { user, isAdmin, refresh } = useAuth();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(user?.display_name ?? '');
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [msg, setMsg] = useState(null);

  const run = async (fn, success) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ severity: 'success', text: success });
    } catch (err) {
      setMsg({ severity: 'error', text: errorMessage(err) });
    }
  };

  return (
    <>
      <PageHeader title={t('settings.title')} />
      <Stack spacing={2.5}>
        <Section title={t('settings.appearance')} description={t('settings.appearanceHint')}>
          <ThemePicker />
        </Section>
        <Section title={t('settings.language')} description={t('settings.languageHint')}>
          <LanguagePicker />
        </Section>
        {isAdmin && <SiteIconSection />}
        {msg && <Alert severity={msg.severity}>{msg.text}</Alert>}
        {user && !user.anonymous && (
          <>
            <Section title={t('settings.profile')}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label={t('auth.displayName')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Button
                  variant="outlined"
                  onClick={() =>
                    run(
                      () => patch('/auth/me', { display_name: name }).then(refresh),
                      t('common.saved'),
                    )
                  }
                >
                  {t('common.save')}
                </Button>
              </Stack>
              <Typography variant="body2" color="textSecondary" sx={{ mt: 1.5 }}>
                {user.email}
              </Typography>
            </Section>
            <Section title={t('settings.changePassword')}>
              <Stack
                component="form"
                spacing={2}
                sx={{ maxWidth: 400 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const { token } = await post('/auth/password', pw);
                    storage.set(TOKEN_KEY, token);
                    setPw({ current_password: '', new_password: '' });
                  }, t('settings.passwordChanged'));
                }}
              >
                <TextField
                  type="password"
                  label={t('settings.currentPassword')}
                  autoComplete="current-password"
                  value={pw.current_password}
                  onChange={(e) => setPw({ ...pw, current_password: e.target.value })}
                />
                <TextField
                  type="password"
                  label={t('settings.newPassword')}
                  autoComplete="new-password"
                  helperText={t('auth.passwordHint')}
                  value={pw.new_password}
                  onChange={(e) => setPw({ ...pw, new_password: e.target.value })}
                />
                <Button type="submit" variant="outlined" sx={{ alignSelf: 'flex-start' }}>
                  {t('settings.changePassword')}
                </Button>
              </Stack>
            </Section>
            <HouseholdSection />
            <NotificationsSection />
          </>
        )}
        <Section title={t('settings.about')}>
          <Typography variant="body2">
            {t('app.name')} {import.meta.env.VITE_APP_VERSION ?? ''} · {t('settings.license')}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            <Link
              href={import.meta.env.VITE_SOURCE_URL || 'https://github.com/itsSivvis/pet-manager'}
              target="_blank"
              rel="noreferrer"
            >
              {t('settings.sourceCode')}
            </Link>
          </Typography>
        </Section>
      </Stack>
    </>
  );
}
