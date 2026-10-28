import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { useTranslation } from 'react-i18next';
import { api, del, photoUrl } from '../../api/client.js';
import { useAuth } from '../../auth/AuthProvider.jsx';
import { useErrorMessage } from '../../lib/useErrorMessage.js';
import Section from '../../components/Section.jsx';

/** Admin-only: custom website icon (favicon) for the whole instance. */
export default function SiteIconSection() {
  const { t } = useTranslation();
  const { status, refresh } = useAuth();
  const errorMessage = useErrorMessage();
  const [msg, setMsg] = useState(null);
  const icon = status?.siteIcon;

  const run = async (fn) => {
    setMsg(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setMsg({ severity: 'error', text: errorMessage(err) });
    }
  };
  const upload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('photo', file);
    run(() => api('/admin/site-icon', { method: 'POST', body }));
  };

  return (
    <Section title={t('settings.siteIcon.title')} description={t('settings.siteIcon.hint')}>
      <Stack spacing={2}>
        {msg && <Alert severity={msg.severity}>{msg.text}</Alert>}
        <Stack direction="row" spacing={2} alignItems="center">
          <Box
            component="img"
            src={icon ? photoUrl(icon) : '/favicon.svg'}
            alt={icon ? t('settings.siteIcon.current') : t('settings.siteIcon.default')}
            sx={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 1 }}
          />
          <Button component="label" variant="outlined">
            {t('settings.siteIcon.upload')}
            <input
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={upload}
            />
          </Button>
          {icon && (
            <Button onClick={() => run(() => del('/admin/site-icon'))}>
              {t('settings.siteIcon.reset')}
            </Button>
          )}
        </Stack>
      </Stack>
    </Section>
  );
}
