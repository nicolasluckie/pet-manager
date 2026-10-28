import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth/AuthProvider.jsx';
import { photoUrl } from './api/client.js';
import { setFavicon } from './lib/favicon.js';
import { useErrorMessage } from './lib/useErrorMessage.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';

// Route-level code splitting: rarely used / heavy pages load on demand.
const PetList = lazy(() => import('./pages/PetList.jsx'));
const PetDetail = lazy(() => import('./pages/PetDetail.jsx'));
const Wiki = lazy(() => import('./pages/Wiki.jsx'));
const PublicWiki = lazy(() => import('./pages/PublicWiki.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

function Loading() {
  const { t } = useTranslation();
  return (
    <Box
      sx={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}
      role="status"
      aria-label={t('common.loading')}
    >
      <CircularProgress />
    </Box>
  );
}

function RequireAuth({ children, admin = false }) {
  const { isAuthenticated, isAdmin } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const errorMessage = useErrorMessage();
  const auth = useAuth();
  const siteIcon = auth.status?.siteIcon;
  useEffect(() => setFavicon(photoUrl(siteIcon) ?? null), [siteIcon]);
  if (auth.loading) return <Loading />;
  if (auth.error && !auth.status) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{errorMessage(auth.error)}</Alert>
      </Box>
    );
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Login mode="login" />} />
          <Route path="/register" element={<Login mode="register" />} />
          <Route path="/wiki/:slug" element={<PublicWiki />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="pets" element={<PetList />} />
            <Route path="pets/:id" element={<PetDetail />} />
            <Route path="pets/:id/:tab" element={<PetDetail />} />
            <Route path="pets/:id/:tab/:itemId" element={<PetDetail />} />
            <Route path="wiki" element={<Wiki />} />
            <Route path="settings" element={<Settings />} />
            <Route
              path="admin"
              element={
                <RequireAuth admin>
                  <Admin />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
