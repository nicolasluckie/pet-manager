import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { get } from '../api/client.js';
import WikiArticle from './wiki/WikiArticle.jsx';

/** Public (no login) page of a pet, reached via its slug, e.g. from an NFC tag or QR code. */
export default function PublicWiki() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const query = useQuery({
    queryKey: ['public-wiki', slug],
    queryFn: () => get(`/public/wiki/${encodeURIComponent(slug)}`),
    retry: false,
  });
  if (query.isPending)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }} role="status">
        <CircularProgress aria-label={t('common.loading')} />
      </Box>
    );
  if (query.isError)
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h5" component="h1">
          {t('wiki.notFound')}
        </Typography>
      </Box>
    );
  return <WikiArticle article={query.data} />;
}
