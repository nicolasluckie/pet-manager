import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Popover from '@mui/material/Popover';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import PetsIcon from '@mui/icons-material/Pets';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import LoginIcon from '@mui/icons-material/Login';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider.jsx';
import Logo from './Logo.jsx';
import ThemePicker from './ThemePicker.jsx';
import PullToRefresh from './PullToRefresh.jsx';

const DRAWER_WIDTH = 248;

export default function Layout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [themeAnchor, setThemeAnchor] = useState(null);
  const { user, isAdmin, logout } = useAuth();
  const location = useLocation();

  const nav = [
    { to: '/', label: t('nav.dashboard'), icon: <DashboardOutlinedIcon />, end: true },
    { to: '/pets', label: t('nav.pets'), icon: <PetsIcon /> },
    { to: '/wiki', label: t('nav.wiki'), icon: <MenuBookOutlinedIcon /> },
    { to: '/settings', label: t('nav.settings'), icon: <SettingsOutlinedIcon /> },
    ...(isAdmin
      ? [{ to: '/admin', label: t('nav.admin'), icon: <AdminPanelSettingsOutlinedIcon /> }]
      : []),
  ];

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ gap: 1.5 }}>
        <Logo />
        <Typography variant="h6" component="div" noWrap>
          {t('app.name')}
        </Typography>
      </Toolbar>
      <List component="nav" aria-label={t('nav.main')} sx={{ flex: 1, pt: 1 }}>
        {nav.map((item) => {
          const selected = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          return (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.end}
              selected={selected}
              aria-current={selected ? 'page' : undefined}
              onClick={() => setMobileOpen(false)}
              sx={{ mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          );
        })}
      </List>
      <Divider />
      <List>
        {user?.anonymous ? (
          <ListItemButton component={NavLink} to="/login">
            <ListItemIcon sx={{ minWidth: 40 }}>
              <LoginIcon />
            </ListItemIcon>
            <ListItemText primary={t('auth.login')} />
          </ListItemButton>
        ) : (
          <ListItemButton onClick={logout}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <LogoutIcon />
            </ListItemIcon>
            <ListItemText primary={t('auth.logout')} secondary={user?.display_name} />
          </ListItemButton>
        )}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      <a href="#main" className="skip-link">
        {t('nav.skipToContent')}
      </a>
      <AppBar
        position="fixed"
        sx={{ width: { md: `calc(100% - ${DRAWER_WIDTH}px)` }, ml: { md: `${DRAWER_WIDTH}px` } }}
      >
        <Toolbar>
          {!isDesktop && (
            <IconButton
              edge="start"
              onClick={() => setMobileOpen(true)}
              aria-label={t('nav.openMenu')}
              sx={{ mr: 1 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          {!isDesktop && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Logo size={28} />
              <Typography variant="h6" component="div" noWrap>
                {t('app.name')}
              </Typography>
            </Box>
          )}
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t('settings.theme')}>
            <IconButton
              onClick={(e) => setThemeAnchor(e.currentTarget)}
              aria-label={t('settings.theme')}
            >
              <PaletteOutlinedIcon />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(themeAnchor)}
            anchorEl={themeAnchor}
            onClose={() => setThemeAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { p: 1.5, width: 280 } } }}
          >
            <ThemePicker compact />
          </Popover>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        {isDesktop ? (
          <Drawer
            variant="permanent"
            open
            sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}
          >
            {drawer}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
          >
            {drawer}
          </Drawer>
        )}
      </Box>

      <Box
        component="main"
        id="main"
        tabIndex={-1}
        sx={{
          flexGrow: 1,
          minWidth: 0,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          outline: 'none',
        }}
      >
        <Toolbar />
        <PullToRefresh>
          <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Outlet />
          </Box>
        </PullToRefresh>
      </Box>
    </Box>
  );
}
