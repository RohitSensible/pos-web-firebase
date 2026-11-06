import { RouteLoadBoundary } from './components/RouteLoadBoundary.tsx';
import { requestUnsavedNavigation, hasUnsavedChanges, UnsavedChangesPrompt } from './utils/unsavedChanges.tsx';
import type { ReplenishmentDraft } from './pages/stockPlanning.ts';
import { DataLoadingModal } from './components/DataLoadingModal.tsx';
import { useDashboardShiftRead } from './utils/useDashboardShiftRead.ts';
import { ActionConfirmation } from './pages/ActionPopup.tsx';
import { PrintPageSettings } from './components/PrintPageSettings.tsx';
import { lazy, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useBrowserHistoryState } from './utils/useBrowserHistoryState.ts';
import { runWorkspaceBack } from './utils/useWorkspaceBack.ts';
import { useWebUsage } from './utils/useWebUsage.ts';
import { useSidebarSections } from './utils/useSidebarSections.ts';
import { OutletAccessPaused, OutletAdmission } from './pages/OutletAccessPaused.tsx';
import { LoginPage, type UserSession } from './pages/LoginPage.tsx';
import { OutletSelectionPage, type OutletSummary } from './pages/OutletSelectionPage.tsx';
import { ReportDateInput } from './pages/ReportDateInput.tsx';
import { ProfileMenu } from './pages/ProfileMenu.tsx';
import type { StockTransferPreview } from './pages/stockTransferPreviews.ts';
import {
  ArrowLeft, ArrowRightLeft, BadgeIndianRupee, Banknote, Bot, Calculator, Download,
  CalendarCheck, CalendarDays, ChevronDown, CircleHelp, ClipboardCheck, Clock,
  ClipboardList, CreditCard, Gauge, Home, Image as ImageIcon,
  LayoutDashboard, LayoutGrid, LogOut, MapPin, Menu, Monitor, Package, PackageCheck, Radio, ReceiptText,
  PackageSearch, RefreshCw, SlidersHorizontal, Store, TrendingUp, Upload,
  ShieldUser, UserRound, Users, UsersRound, WalletCards, X,
} from 'lucide-react';
import { downloadDashboardExcel, type ShiftDashboardData } from './utils/dashboardExcel.ts';
import { dashboardShiftStatus } from '../../shared/shiftStatus.ts';
import { createDeviceQrSvg } from './utils/deviceQr.ts';
import './App.css';
import './Theme.css';

// Keep lazy component identities stable across clock, session and navigation updates.
const OutletLogoPage = lazy(() => import('./pages/OutletLogoPage.tsx').then(module => ({ default: module.OutletLogoPage })));
const CategoryPage = lazy(() => import('./pages/CategoryPage.tsx').then(module => ({ default: module.CategoryPage })));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage.tsx').then(module => ({ default: module.EmployeesPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage.tsx').then(module => ({ default: module.CustomersPage })));
const DevicesPage = lazy(() => import('./pages/DevicesPage.tsx').then(module => ({ default: module.DevicesPage })));
const BroadcastPage = lazy(() => import('./pages/BroadcastPage.tsx').then(module => ({ default: module.BroadcastPage })));
const TransferPreviewPage = lazy(() => import('./pages/TransferPreviewPage.tsx').then(module => ({ default: module.TransferPreviewPage })));
const MulticounterPage = lazy(() => import('./pages/MulticounterPage.tsx').then(module => ({ default: module.MulticounterPage })));
const UserAccountPage = lazy(() => import('./pages/UserAccountPage.tsx').then(module => ({ default: module.UserAccountPage })));
const ProductsPage = lazy(() => import('./pages/ProductsPage.tsx').then(module => ({ default: module.ProductsPage })));
const ServicePointsPage = lazy(() => import('./pages/ServicePointsPage.tsx').then(module => ({ default: module.ServicePointsPage })));
const PremisesPage = lazy(() => import('./pages/PremisesPage.tsx').then(module => ({ default: module.PremisesPage })));
const UploadExcelPage = lazy(() => import('./pages/UploadExcelPage.tsx').then(module => ({ default: module.UploadExcelPage })));
const BillWiseReportPage = lazy(() => import('./pages/BillWiseReportPage.tsx').then(module => ({ default: module.BillWiseReportPage })));
const ShiftSummaryReportPage = lazy(() => import('./pages/ShiftSummaryReportPage.tsx').then(module => ({ default: module.ShiftSummaryReportPage })));
const DaywiseReportPage = lazy(() => import('./pages/DaywiseReportPage.tsx').then(module => ({ default: module.DaywiseReportPage })));
const CategoryWiseReportPage = lazy(() => import('./pages/CategoryWiseReportPage.tsx').then(module => ({ default: module.CategoryWiseReportPage })));
const ProductWiseReportPage = lazy(() => import('./pages/ProductWiseReportPage.tsx').then(module => ({ default: module.ProductWiseReportPage })));
const GstReportPage = lazy(() => import('./pages/GstReportPage.tsx').then(module => ({ default: module.GstReportPage })));
const GstDaywiseReportPage = lazy(() => import('./pages/GstDaywiseReportPage.tsx').then(module => ({ default: module.GstDaywiseReportPage })));
const StockReportPage = lazy(() => import('./pages/StockReportPage.tsx').then(module => ({ default: module.StockReportPage })));
const StockInOutReportPage = lazy(() => import('./pages/StockInOutReportPage.tsx').then(module => ({ default: module.StockInOutReportPage })));
const StockAdjustmentPage = lazy(() => import('./pages/StockAdjustmentPage.tsx').then(module => ({ default: module.StockAdjustmentPage })));
const GoodsReceivedPage = lazy(() => import('./pages/GoodsReceivedPage.tsx').then(module => ({ default: module.GoodsReceivedPage })));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage.tsx').then(module => ({ default: module.SuppliersPage })));
const StockTransferReportPage = lazy(() => import('./pages/StockTransferReportPage.tsx').then(module => ({ default: module.StockTransferReportPage })));
const StockTransferPage = lazy(() => import('./pages/StockTransferPage.tsx').then(module => ({ default: module.StockTransferPage })));

const disabledNavigationItems = new Set(['Operations:Broadcast', 'Operations:Multicounter']);

function Sparkline({ tone = 'cyan', compact = false }: { tone?: 'cyan' | 'green' | 'muted'; compact?: boolean }) {
  return (
    <svg className={`sparkline ${compact ? 'compact' : ''}`} viewBox="0 0 180 55" role="img" aria-label="Sales trend" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-fill-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M2 47 L30 47 L45 34 L58 27 L72 35 L86 33 L98 13 L112 43 L125 28 L145 27 L178 11 L178 55 L2 55 Z" fill={`url(#spark-fill-${tone})`} />
      <path className="sparkline-line" d="M2 47 L30 47 L45 34 L58 27 L72 35 L86 33 L98 13 L112 43 L125 28 L145 27 L178 11" />
    </svg>
  );
}

function KpiCard({ label, value, tone, icon }: { label: string; value: string; tone: 'cyan' | 'green' | 'muted'; icon: ReactNode }) {
  return (
    <article className={`kpi-card ${tone}`}>
      <div className="kpi-card-topline"><span>{label}</span><span className="kpi-icon">{icon}</span></div>
      <strong>{value}</strong>
      <Sparkline tone={tone} />
    </article>
  );
}

function PaymentTile({ label, value = '₹ 0', brand, featured = false }: { label: string; value?: string; brand: ReactNode; featured?: boolean }) {
  return (
    <article className={`payment-tile ${featured ? 'featured' : ''}`}>
      <span className="payment-brand">{brand}</span>
      <div className="payment-copy"><span>{label}</span><strong>{value}</strong></div>
      {featured && <Sparkline compact />}
    </article>
  );
}

function MetricRow({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="metric-row">
      <span className="metric-label">{icon}<span>{label}</span></span>
      <strong>{value}</strong>
    </div>
  );
}

function DashboardDeviceQr({ deviceId }: { deviceId: string }) {
  const code = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    void createDeviceQrSvg(deviceId).then(svg => {
      if (!active) return;
      code.current?.replaceChildren(svg);
      setStatus('ready');
    }, () => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [deviceId]);
  return <div className="dashboard-device-qr" ref={code} aria-busy={status === 'loading'}
    role={status === 'error' ? 'img' : undefined} aria-label={status === 'error' ? 'Device QR code unavailable' : undefined} />;
}

function LogoutConfirmation({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return <ActionConfirmation action="log out" item="of your account" title="Log out?" confirmLabel="Logout" onCancel={onCancel} onConfirm={onConfirm}>{hasUnsavedChanges() && <p>Unsaved edits will be lost when you log out.</p>}</ActionConfirmation>;
}


function localDayId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMoney(value = 0): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

const navigationGroups = [
    { label: 'Home', icon: <Home />, items: [{ label: 'Dashboard', icon: <LayoutDashboard /> }] },
    { label: 'Masters', icon: <ClipboardList />, items: [
      { label: 'Logo', icon: <ImageIcon /> },
      { label: 'Category', icon: <LayoutGrid /> },
      { label: 'Products', icon: <Package /> },
      { label: 'Service Point', icon: <MapPin /> },
      { label: 'Premises', icon: <Store /> },
      { label: 'Goods Received', icon: <PackageCheck /> },
      { label: 'Suppliers', icon: <UsersRound /> },
      { label: 'User Account', icon: <ShieldUser /> },
      { label: 'Employees/Salesman', icon: <UsersRound /> },
      { label: 'Product Transfer', icon: <ArrowRightLeft /> },
      { label: 'Customer', icon: <UserRound /> },
    ] },
    { label: 'Inventory', icon: <Package />, items: [
      { label: 'Stock In and Out', icon: <ClipboardCheck /> },
      { label: 'Stock Transfer', icon: <ArrowRightLeft /> },
    ] },
    { label: 'Operations', icon: <Bot />, items: [
      { label: 'Upload Excel', icon: <Upload /> },
      { label: 'Multicounter', icon: <Users /> },
      { label: 'Device', icon: <Monitor /> },
      { label: 'Broadcast', icon: <Radio /> },
    ] },
    { label: 'Reports', icon: <ReceiptText />, items: [
      { label: 'Day Wise Report', icon: <CalendarDays /> },
      { label: 'Shift Summary Report', icon: <CalendarCheck /> },
      { label: 'Category Wise', icon: <SlidersHorizontal /> },
      { label: 'Product Wise', icon: <PackageSearch /> },
      { label: 'Stock Report', icon: <ClipboardCheck /> },
      { label: 'Stock In-Out Report', icon: <ClipboardList /> },
      { label: 'Stock Transfer Report', icon: <ArrowRightLeft /> },
      { label: 'GST Report', icon: <Calculator /> },
      { label: 'GST Report Day Wise', icon: <CalendarCheck /> },
      { label: 'Bill Wise Sale Report', icon: <ReceiptText /> },
    ] },
  ].map(group => {
    if (group.label !== 'Masters') return group;
    const items = [...group.items].sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
    const productsIndex = items.findIndex(item => item.label === 'Products');
    const [products] = items.splice(productsIndex, 1);
    items.splice(items.findIndex(item => item.label === 'Category') + 1, 0, products!);
    return { ...group, items };
  });

const screens = navigationGroups.flatMap(group => group.items.map(item => ({ id: `${group.label}:${item.label}`, label: item.label })))
  .filter(screen => !disabledNavigationItems.has(screen.id));
const validScreen = (value: unknown): value is string => typeof value === 'string' && screens.some(screen => screen.id === value);

const MemoProductsPage = memo(ProductsPage);
const MemoCategoryPage = memo(CategoryPage);
const MemoCustomersPage = memo(CustomersPage);
const MemoEmployeesPage = memo(EmployeesPage);
const MemoOutletLogoPage = memo(OutletLogoPage);

export default function App() {
  return <><Application /><DataLoadingModal /><UnsavedChangesPrompt /></>;
}

function Application() {
  const [screenId, navigate, back] = useBrowserHistoryState('pos-screen', 'Home:Dashboard', validScreen, false);
  const activeNavigation = screens.find(screen => screen.id === screenId)!;
  const setActiveNavigation = (screen: { id: string; label: string }) => navigate(screen.id);
  const { openGroup, toggleGroup } = useSidebarSections(activeNavigation.id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clock, setClock] = useState('16:45:21');
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('pos_theme') === 'dark'; }
    catch { return false; }
  });
  const [session, setSession] = useState<UserSession | null>(() => {
    const saved = localStorage.getItem('pos_user_session');
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved) as Partial<UserSession>;
      if (parsed.id && parsed.email && parsed.name && parsed.role && parsed.terminal && parsed.token) {
        return parsed as UserSession;
      }
      localStorage.removeItem('pos_user_session');
      return null;
    } catch {
      localStorage.removeItem('pos_user_session');
      return null;
    }
  });
  const [selectedOutlet, setSelectedOutlet] = useState<OutletSummary | null>(() => {
    const saved = localStorage.getItem('pos_selected_outlet');
    if (!saved) return null;
    try { return JSON.parse(saved) as OutletSummary; } catch { return null; }
  });
  const previewSessionKey = session ? JSON.stringify([session.id, session.token]) : '';
  const [transferPreviews, setTransferPreviews] = useState<{ sessionKey: string; records: StockTransferPreview[]; reportDate?: string }>({ sessionKey: '', records: [] });
  const sessionTransferPreviews = transferPreviews.sessionKey === previewSessionKey ? transferPreviews.records : [];
  const previewReportDate = transferPreviews.sessionKey === previewSessionKey ? transferPreviews.reportDate : undefined;
  const [usageExit, setUsageExit] = useState<{ outlet: { name: string; branch: string }; userName: string } | null>(null);
  const [externalInvalidated, setExternalInvalidated] = useState<'account' | 'outlet' | null>(null);
  const usage = useWebUsage(externalInvalidated ? undefined : session?.token, selectedOutlet?.id);
  const releaseUsage = usage.release;
  const [dashboardReloadKey, setDashboardReloadKey] = useState(0);
  const [dashboardDay, setDashboardDay] = useState(localDayId);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('all');
  const [dashboardExporting, setDashboardExporting] = useState(false);
  const [dashboardExportError, setDashboardExportError] = useState('');
  const dashboardExportBusy = useRef(false);
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false);
  const [receiptDraft, setReceiptDraft] = useState<{ sessionKey: string; outletId: string; draft: ReplenishmentDraft } | null>(null);


  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    try { localStorage.setItem('pos_theme', darkMode ? 'dark' : 'light'); }
    catch { /* The theme still works when browser storage is unavailable. */ }
  }, [darkMode]);

  useEffect(() => {
    const updateClock = () => setClock(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleLoginSuccess = useCallback((user: UserSession) => {
    setTransferPreviews({ sessionKey: '', records: [] });
    navigate('Home:Dashboard');
    setUsageExit(null);
    setSession(user);
    setSelectedOutlet(null);
    setSelectedShiftId('all');
    localStorage.setItem('pos_user_session', JSON.stringify(user));
    localStorage.removeItem('pos_selected_outlet');
  }, [navigate]);

  const handleAccountSaved = (details: { name: string | null; email: string | null }) => {
    if (!session) return;
    const updated = { ...session, ...(details.name !== null ? { name: details.name } : {}),
      ...(details.email !== null ? { email: details.email } : {}) };
    setSession(updated);
    localStorage.setItem('pos_user_session', JSON.stringify(updated));
  };

  const handleLogout = useCallback(() => {
    setTransferPreviews({ sessionKey: '', records: [] });
    setUsageExit(null);
    setExternalInvalidated(null);
    void releaseUsage().catch(() => undefined);
    setLogoutConfirmationOpen(false);
    setSession(null);
    setSelectedOutlet(null);
    setSelectedShiftId('all');
    localStorage.removeItem('pos_user_session');
    localStorage.removeItem('pos_selected_outlet');
  }, [releaseUsage]);

  const exhaustedSession = useRef<string | null>(null);
  useEffect(() => {
    if (!usage.blocked || usage.dailyLimitApplies === false || !session || !selectedOutlet) { exhaustedSession.current = null; return; }
    const key = `${session.token}:${selectedOutlet.id}`;
    if (exhaustedSession.current === key) return;
    exhaustedSession.current = key;
    const context = { outlet: { name: selectedOutlet.name, branch: selectedOutlet.branch }, userName: session.name };
    handleLogout();
    // Preserve only display context for the restricted-outlet notice, never its
    // authentication, selected outlet, counters, or lease credentials.
    setUsageExit(context);
  }, [usage.blocked, usage.dailyLimitApplies, session, selectedOutlet, handleLogout]);

  useEffect(() => {
    if (!session || !selectedOutlet) return;
    const changed = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== null && event.key !== 'pos_user_session' && event.key !== 'pos_selected_outlet') return;
      const invalidate = (reason: 'account' | 'outlet') => {
        if (usage.dailyLimitApplies === true) { setExternalInvalidated(reason); return; }
        void releaseUsage().catch(() => undefined);
        if (reason === 'account') setSession(null);
        setSelectedOutlet(null);
        // Preserve the new login/selection owned by the other tab.
      };
      try {
        const user = JSON.parse(localStorage.getItem('pos_user_session') || 'null');
        const outlet = JSON.parse(localStorage.getItem('pos_selected_outlet') || 'null');
        if (user?.token !== session.token) invalidate('account');
        else if (outlet?.id !== selectedOutlet.id) invalidate('outlet');
      } catch { invalidate('account'); }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [session, selectedOutlet, usage.dailyLimitApplies, releaseUsage]);
  const leaveInvalidatedSession = useCallback(() => {
    void releaseUsage().catch(() => undefined);
    setExternalInvalidated(null);
    if (externalInvalidated === 'account') setSession(null);
    setSelectedOutlet(null);
    // Another tab may now own a different login. Do not overwrite its storage.
  }, [releaseUsage, externalInvalidated]);

  const requestLogout = useCallback(() => {
    setLogoutConfirmationOpen(true);
  }, []);

  const handleOutletSelect = useCallback((outlet: OutletSummary) => {
    navigate('Home:Dashboard');
    setSelectedOutlet(outlet);
    setSelectedShiftId('all');
    localStorage.setItem('pos_selected_outlet', JSON.stringify(outlet));
  }, [navigate]);

  const handleChangeOutlet = useCallback(() => {
    void releaseUsage().catch(() => undefined);
    setSelectedOutlet(null);
    setSelectedShiftId('all');
    localStorage.removeItem('pos_selected_outlet');
  }, [releaseUsage]);

  const requestChangeOutlet = useCallback(() => {
    requestUnsavedNavigation(handleChangeOutlet);
  }, [handleChangeOutlet]);

  useEffect(() => {
    if (usage.denied === 'account') handleLogout();
    else if (usage.denied === 'outlet') handleChangeOutlet();
  }, [usage.denied, handleLogout, handleChangeOutlet]);

  const { data: dashboardData, loading: dashboardLoading, error: dashboardError, updated: dashboardUpdated } = useDashboardShiftRead({
    outletId: selectedOutlet?.id, token: session?.token, day: dashboardDay,
    enabled: !!session && !!selectedOutlet && usage.ready && !externalInvalidated && activeNavigation.id === 'Home:Dashboard',
    reload: dashboardReloadKey, onUnauthorized: handleLogout,
  });
  const dashboardExportController = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    dashboardExportBusy.current = false;
    setDashboardExporting(false); setDashboardExportError('');
    return () => {
      dashboardExportController.current?.abort();
      dashboardExportController.current = null;
    };
  }, [selectedOutlet?.id, session?.token, dashboardDay, dashboardReloadKey, activeNavigation.id]);
  const effectiveShiftId = selectedShiftId === 'all' || dashboardData?.shifts?.some(shift => shift.id === selectedShiftId)
    ? selectedShiftId : 'all';
  useEffect(() => {
    if (dashboardData && selectedShiftId !== 'all' && !dashboardData.shifts?.some(shift => shift.id === selectedShiftId)) setSelectedShiftId('all');
  }, [dashboardData, selectedShiftId]);

  const exportDashboard = async () => {
    if (!session || !selectedOutlet || !dashboardData || dashboardLoading || dashboardError
      || dashboardData.dayId !== dashboardDay || dashboardExportBusy.current) return;
    const controller = new AbortController();
    dashboardExportController.current = controller;
    dashboardExportBusy.current = true;
    setDashboardExporting(true); setDashboardExportError('');
    try {
      await downloadDashboardExcel({ outlet: selectedOutlet, dayId: dashboardDay,
        cashier: session.name, terminal: session.terminal, data: dashboardData, signal: controller.signal });
    } catch {
      if (!controller.signal.aborted) setDashboardExportError('Unable to download the dashboard Excel file. Please try Export again.');
    } finally {
      if (dashboardExportController.current === controller) { dashboardExportBusy.current = false; setDashboardExporting(false); }
    }
  };

  if (!session) return usageExit ? <>
    <div hidden inert aria-hidden="true"><LoginPage onLoginSuccess={handleLoginSuccess} /></div>
    <OutletAccessPaused outlet={usageExit.outlet} userName={usageExit.userName} message="" blocked checking={false} signedOut
      onResume={() => setUsageExit(null)} onChangeOutlet={() => setUsageExit(null)} onSignOut={() => setUsageExit(null)} />
  </> : <LoginPage onLoginSuccess={handleLoginSuccess} />;
  if (!selectedOutlet) return (
    <>
      <OutletSelectionPage session={session} onSelect={handleOutletSelect} onLogout={requestLogout} />
      {logoutConfirmationOpen && <LogoutConfirmation onCancel={() => setLogoutConfirmationOpen(false)} onConfirm={handleLogout} />}
    </>
  );

  // Only a confirmed restricted outlet may show the daily-usage screens.
  // External notices are set only for a previously confirmed restricted session.
  const restrictedSession = usage.dailyLimitApplies === true || Boolean(externalInvalidated);
  const accessPaused = restrictedSession && ((!usage.ready && !usage.silentResume) || Boolean(externalInvalidated));
  const reconnecting = !restrictedSession && !usage.ready && !usage.silentResume;

  const shifts = dashboardData?.shifts ?? [];
  const displayData = effectiveShiftId === 'all' ? dashboardData : shifts.find(shift => shift.id === effectiveShiftId) ?? null;
  const orderedShifts = [...shifts].sort((a, b) => (a.startTime - b.startTime) || (a.shiftNo - b.shiftNo) || a.id.localeCompare(b.id));
  const shiftToShow = effectiveShiftId === 'all'
    ? (orderedShifts.filter(shift => !shift.inActive).at(-1) ?? orderedShifts.at(-1))
    : shifts.find(shift => shift.id === effectiveShiftId);
  const shiftLabel = (shift: ShiftDashboardData) => {
    const label = `Shift ${shift.shiftNo || '—'}`;
    if (shifts.filter(other => other.shiftNo === shift.shiftNo).length < 2) return label;
    const date = new Date(shift.startTime);
    const time = shift.startTime > 0 && Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : 'Time unavailable';
    const peers = orderedShifts.filter(other => other.shiftNo === shift.shiftNo && other.deviceId === shift.deviceId && other.startTime === shift.startTime);
    return `${label} · ${shift.deviceId?.trim() || 'Device unavailable'} · ${time}${peers.length > 1 ? ` · ${peers.indexOf(shift) + 1}` : ''}`;
  };
  const shiftTabs = [{ id: 'all', label: 'All Shifts' }, ...shifts.map(shift => ({ id: shift.id, label: shiftLabel(shift) }))];
  const selectedTabIndex = Math.max(0, shiftTabs.findIndex(tab => tab.id === effectiveShiftId));
  const shiftTime = (value: number | undefined) => {
    if (!value || !Number.isFinite(value)) return 'Not Available';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not Available' : date.toLocaleString();
  };

  const payments = displayData?.payments ?? {};
  const cashInHand = displayData
    ? displayData.openingAmt + displayData.cashSale - displayData.expCash
    : 0;



  return (
    <>
    {accessPaused && !usage.authorized && !usage.message && !externalInvalidated
      ? <OutletAdmission onRetry={usage.retry} onSignOut={handleLogout} />
      : accessPaused && <OutletAccessPaused outlet={selectedOutlet} userName={session.name}
      message={externalInvalidated === 'account' ? 'Your session changed in another tab. Sign in again to continue.' : externalInvalidated === 'outlet' ? 'Your outlet changed in another tab. Choose an outlet to continue.' : usage.message}
      blocked={usage.blocked} checking={!externalInvalidated && !usage.message && !usage.blocked}
      onResume={externalInvalidated ? leaveInvalidatedSession : usage.retry}
      onChangeOutlet={externalInvalidated ? leaveInvalidatedSession : handleChangeOutlet} onSignOut={handleLogout} />}
    <div className="retail-dashboard-shell" inert={accessPaused} aria-hidden={accessPaused || undefined} style={accessPaused ? { visibility: 'hidden', display: 'none' } : undefined}>
      <PrintPageSettings outletName={selectedOutlet.name} />
      {sidebarOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`dashboard-sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Primary navigation">
        <button type="button" className="sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X /></button>
        <div className="business-profile">
          <div className="business-outlet-heading"><small>Current Outlet</small>
            {selectedOutlet.active !== false && <span className="business-outlet-status"><i className="business-outlet-active" role="img" aria-label="Active outlet" />Active</span>}</div>
          <div className="business-outlet-summary">
            <span className="business-avatar">{selectedOutlet.name.slice(0, 2).toUpperCase()}</span>
            <div className="business-outlet-details"><strong><span className="business-outlet-name">{selectedOutlet.name}</span></strong><span>{selectedOutlet.branch || selectedOutlet.country}</span></div>
          </div>
          <button type="button" className="business-outlet-switch" aria-label="Change Outlet" title="Change Outlet" onClick={requestChangeOutlet}><RefreshCw aria-hidden="true" />Change Outlet</button>
        </div>
        <nav className="sidebar-nav">
          {navigationGroups.map((group) => (
            <section
              className={`nav-group ${group.label === 'Masters' ? 'masters-group' : ''} ${group.label === 'Reports' ? 'reports-group' : ''}`}
              key={group.label}
            >
              <div
                className="nav-group-title"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleGroup(group.label)}
              >
                <span>{group.icon}{group.label}</span>
                <ChevronDown
                  style={{
                    transform: openGroup === group.label ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.2s ease',
                  }}
                />
              </div>
              {openGroup === group.label && (
                <div className="nav-group-items">
                  {group.items.filter(item => !disabledNavigationItems.has(`${group.label}:${item.label}`)).map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className={activeNavigation.id === `${group.label}:${item.label}` ? 'active' : ''}
                      onClick={() => {
                        setActiveNavigation({ id: `${group.label}:${item.label}`, label: item.label });
                        setSidebarOpen(false);
                      }}
                    >
                      <span className="nav-item-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="plan-card">
            <small>Your Plan</small>
            <div><strong>POS Pro</strong><span>Active</span></div>
            <p>Valid till 24 Jan 2029</p>
            <button type="button">Upgrade Plan</button>
          </div>
          <button type="button" className="sidebar-logout" onClick={requestLogout}><LogOut aria-hidden="true" /> Logout</button>
        </div>
      </aside>

      <div className="dashboard-stage">
        <header className="retail-header">
          <div className="header-brand">
            <button type="button" className="mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu /></button>
            <span className="header-logo-crop">
              <img src="/logo1.png" alt="Sensible Connect — Built for Business" />
            </span>
          </div>
          <div className="header-actions">
            <button className="theme-button" type="button" aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={darkMode} title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setDarkMode(current => !current)}><span aria-hidden="true">☾</span></button>
            <ProfileMenu key={`${session.id}:${selectedOutlet.id}`} session={session} outletId={selectedOutlet.id} onSessionExpired={handleLogout} onChangeOutlet={requestChangeOutlet} />
          </div>
        </header>

        {reconnecting && usage.dailyLimitApplies === null && usage.message && <div className="outlet-connection-status" data-outlet-connection role="alert">
          <span>{usage.message}</span>
          <button type="button" onClick={usage.retry}>Retry connection</button>
          <button type="button" onClick={handleLogout}>Sign Out</button>
        </div>}
        <main className="dashboard-workspace" inert={reconnecting} aria-hidden={reconnecting || undefined}
          style={reconnecting ? { visibility: 'hidden' } : undefined}>
          {/* Back first leaves an open in-page form or sub-screen; otherwise it returns to the previous
              screen (as browser Back), or to the Dashboard when the tab has no earlier entry. */}
          {activeNavigation.id !== 'Home:Dashboard' && <button type="button" className="workspace-back" aria-label="Back to previous screen"
            onClick={() => { if (runWorkspaceBack()) return; if (window.history.length > 1) back(); else navigate('Home:Dashboard'); }}><ArrowLeft aria-hidden="true" />Back</button>}
          <RouteLoadBoundary key={activeNavigation.id}>
          {!usage.authorized ? null : activeNavigation.id === 'Masters:Logo' ? (
            <MemoOutletLogoPage outletId={selectedOutlet.id} outletName={selectedOutlet.name} token={session.token} />
          ) : activeNavigation.id === 'Masters:Suppliers' ? (
            <SuppliersPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Goods Received' ? (
            <GoodsReceivedPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} onCancel={() => setActiveNavigation({ id: 'Home:Dashboard', label: 'Dashboard' })}
              initialDraft={receiptDraft?.sessionKey === previewSessionKey && receiptDraft.outletId === selectedOutlet.id ? receiptDraft.draft : undefined} onDraftConsumed={() => setReceiptDraft(null)} />
          ) : activeNavigation.id === 'Inventory:Stock In and Out' ? (
            <StockAdjustmentPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Operations:Multicounter' ? (
            <MulticounterPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Operations:Device' ? (
            <DevicesPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Operations:Broadcast' ? (
            <BroadcastPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Inventory:Stock Transfer' ? (
            <StockTransferPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout}
              onPreviewConfirmed={preview => setTransferPreviews(current => ({ ...(current.sessionKey === previewSessionKey ? current : {}), sessionKey: previewSessionKey,
                records: [preview, ...(current.sessionKey === previewSessionKey ? current.records.filter(record => record.id !== preview.id) : [])] }))}
              onViewReport={date => { setTransferPreviews(current => ({ sessionKey: previewSessionKey, records: current.sessionKey === previewSessionKey ? current.records : [], reportDate: date })); navigate('Reports:Stock Transfer Report'); }} />
          ) : activeNavigation.id === 'Masters:Product Transfer' ? (
            <TransferPreviewPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Service Point' ? (
            <ServicePointsPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Customer' ? (
            <MemoCustomersPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Employees/Salesman' ? (
            <MemoEmployeesPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:User Account' ? (
            <UserAccountPage key={session.id} token={session.token} onSessionExpired={handleLogout} onSaved={handleAccountSaved} />
          ) : activeNavigation.id === 'Reports:Bill Wise Sale Report' ? (
            <BillWiseReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Category Wise' ? (
            <CategoryWiseReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Product Wise' ? (
            <ProductWiseReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Stock Report' ? (
            <StockReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout}
              onPrepareReceipt={draft => requestUnsavedNavigation(() => { setReceiptDraft({ sessionKey: previewSessionKey, outletId: selectedOutlet.id, draft }); navigate('Masters:Goods Received'); })} />
          ) : activeNavigation.id === 'Reports:Stock In-Out Report' ? (
            <StockInOutReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Stock Transfer Report' ? (
            <StockTransferReportPage key={`${session.id}:${selectedOutlet.id}:${previewReportDate ?? ''}`} outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} previews={sessionTransferPreviews} initialPreviewDate={previewReportDate} />
          ) : activeNavigation.id === 'Reports:GST Report' ? (
            <GstReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:GST Report Day Wise' ? (
            <GstDaywiseReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Shift Summary Report' ? (
            <ShiftSummaryReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Reports:Day Wise Report' ? (
            <DaywiseReportPage outlet={selectedOutlet} reportName={activeNavigation.label} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Category' ? (
            <MemoCategoryPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Premises' ? (
            <PremisesPage key={`${session.id}:${selectedOutlet.id}`} outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Masters:Products' || activeNavigation.id === 'Inventory:Products' ? (
            <MemoProductsPage outlet={selectedOutlet} token={session.token} onSessionExpired={handleLogout} />
          ) : activeNavigation.id === 'Inventory:Upload Excel' || activeNavigation.id === 'Operations:Upload Excel' ? (
            <UploadExcelPage outletId={selectedOutlet.id} token={session.token} onSessionExpired={handleLogout} />
          ) : (
            <>
              <section className="page-hero">
                <div className="dashboard-outlet-heading">
                  <h1><Store size={20} aria-hidden="true" /><span>{selectedOutlet.name}</span></h1>
                  <p className="dashboard-branch"><strong>{selectedOutlet.branch || 'Not specified'}</strong></p>
                  <p className="dashboard-subtitle"><TrendingUp size={14} aria-hidden="true" />Daily sales performance</p>
                </div>
                <div className="hero-actions"><div className="shift-selector-bar" role="tablist" aria-label="Shift view selection">
                  {shiftTabs.map((tab, index) => <button key={tab.id} id={`dashboard-shift-tab-${index}`} type="button" role="tab"
                    aria-selected={effectiveShiftId === tab.id} aria-controls="dashboard-shift-panel" tabIndex={selectedTabIndex === index ? 0 : -1}
                    className={`shift-pill ${effectiveShiftId === tab.id ? 'active' : ''}`} onClick={() => setSelectedShiftId(tab.id)}
                    onKeyDown={event => {
                      const next = event.key === 'Home' ? 0 : event.key === 'End' ? shiftTabs.length - 1
                        : event.key === 'ArrowRight' ? (index + 1) % shiftTabs.length
                        : event.key === 'ArrowLeft' ? (index - 1 + shiftTabs.length) % shiftTabs.length : null;
                      if (next === null) return;
                      event.preventDefault(); setSelectedShiftId(shiftTabs[next]!.id);
                      document.getElementById(`dashboard-shift-tab-${next}`)?.focus();
                    }}>{tab.label}</button>)}
                </div><label className="dashboard-date-picker" htmlFor="dashboard-report-date"><ReportDateInput id="dashboard-report-date" aria-label="Dashboard date" value={dashboardDay} onChange={value => { if (value) { setDashboardDay(value); setSelectedShiftId('all'); } }} /><span className="dashboard-time"><Clock size={14} aria-hidden="true" />{clock}</span></label><button type="button" title="Export all shifts for the selected date" onClick={() => void exportDashboard()} disabled={!dashboardData || dashboardLoading || !!dashboardError || dashboardExporting || dashboardData.dayId !== dashboardDay}>{dashboardExporting ? <RefreshCw /> : <Download />}{dashboardExporting ? 'Exporting…' : 'Export All Shifts'}</button></div>
              </section>

              {dashboardLoading && <div className="dashboard-data-notice" data-inline-loading><RefreshCw className="dashboard-data-spinner" /> Loading shift data…</div>}
              {dashboardError && <div className="dashboard-data-notice error"><span>{dashboardError}{dashboardData && dashboardUpdated ? ` Showing last good data. Last updated ${new Date(dashboardUpdated).toLocaleString()}. Export is unavailable.` : ''}</span><button type="button" disabled={dashboardLoading} onClick={() => setDashboardReloadKey(value => value + 1)}><RefreshCw /> Retry</button></div>}

              {dashboardExportError && <div className="dashboard-data-notice error" role="alert">{dashboardExportError}</div>}

              <div className="dashboard-columns" id="dashboard-shift-panel" role="tabpanel" aria-labelledby={`dashboard-shift-tab-${selectedTabIndex}`}>
              <div className="dashboard-primary">
              <section className="kpi-grid" aria-label="Key sales figures">
                <KpiCard label="Cash In Hand" value={formatMoney(cashInHand)} tone="green" icon={<Banknote />} />
                <KpiCard label="Total Sale" value={formatMoney(displayData?.totalSale)} tone="cyan" icon={<TrendingUp />} />
                <KpiCard label="Total Digital Sale" value={formatMoney(displayData?.digitalSale)} tone="muted" icon={<span className="upi-wordmark">UPI</span>} />
              </section>

              <section className="payment-section">
                <div className="section-heading"><div><h2>Other Sales</h2><p>Sales by payment method{effectiveShiftId !== 'all' ? ` (Shift ${displayData?.shiftNo})` : ''}</p></div><SlidersHorizontal /></div>
                <div className="payment-grid">
                  <PaymentTile label="Cash" value={formatMoney(payments.cash ?? displayData?.cashSale)} featured brand={<Banknote />} />
                  <PaymentTile label="Google Pay" value={formatMoney(payments.googlepay)} brand={<span className="google-pay-mark">G</span>} />
                  <PaymentTile label="PhonePe" value={formatMoney(payments.phonepe)} brand={<span className="phonepe-mark">पे</span>} />
                  <PaymentTile label="Paytm" value={formatMoney(payments.paytm)} brand={<span className="paytm-mark">paytm</span>} />
                  <PaymentTile label="Cheque" value={formatMoney(payments.cheque_payment_mode)} brand={<ReceiptText />} />
                  <PaymentTile label="Card" value={formatMoney(payments.card)} brand={<CreditCard />} />
                  <PaymentTile label="Credit" value={formatMoney(payments.credit ?? displayData?.creditSale)} brand={<WalletCards />} />
                  <PaymentTile label="Other" value={formatMoney(payments.other)} brand={<SlidersHorizontal />} />
                </div>
              </section>

              <section className="bottom-panels">
                <article className="detail-panel">
                  <h2>Operational Summary{effectiveShiftId !== 'all' ? ` (Shift ${displayData?.shiftNo})` : ''}</h2>
                  <div className="detail-grid">
                    <MetricRow icon={<ReceiptText />} label="No. of Bills" value={String(displayData?.billCount ?? 0)} />
                    <MetricRow icon={<BadgeIndianRupee />} label="Total Discount" value={formatMoney(displayData?.discount)} />
                    <MetricRow icon={<WalletCards />} label="Opening Balance" value={formatMoney(displayData?.openingAmt)} />
                    <MetricRow icon={<span className="percent-icon">%</span>} label="Total Tax" value={formatMoney(displayData?.tax)} />
                    <MetricRow icon={<Gauge />} label="Refund Amount" value={formatMoney(displayData?.refundAmount)} />
                    <MetricRow icon={<WalletCards />} label="Extra Charge" value={formatMoney(displayData?.extraCharges)} />
                  </div>
                </article>
                <article className="detail-panel">
                  <h2>Expenses &amp; Credits{effectiveShiftId !== 'all' ? ` (Shift ${displayData?.shiftNo})` : ''}</h2>
                  <div className="detail-grid expenses-grid">
                    <MetricRow label="Total Expenses" value={formatMoney(displayData?.expensesAmtTotal)} />
                    <MetricRow label="Advance Payment" value={formatMoney(displayData?.advanceAmtTotal)} />
                    <MetricRow label="Received Customer Credit" value={formatMoney(displayData?.customerReceiveAmtTotal)} />
                  </div>
                </article>
              </section>
              </div>

              <aside className="dashboard-insights">
                <article className="insight-card shift-card">
                  <h2>Shift Details</h2>
                  <p className="shift-card-context">{effectiveShiftId === 'all' ? (shiftToShow && !shiftToShow.inActive ? 'Current Active Shift' : 'Latest Shift') : `Shift ${shiftToShow?.shiftNo ?? '—'}`} · Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
                  <div><span>Outlet</span><strong>{selectedOutlet.name}</strong></div>
                  <div><span>Branch</span><strong>{selectedOutlet.branch || 'Not specified'}</strong></div>
                  <div><span>Terminal</span><strong>{session.terminal} (web workspace)</strong></div>
                  <div><span>Shift No.</span><strong>Shift {shiftToShow?.shiftNo || '—'}</strong></div>
                  <div><span>Created By</span><strong>{shiftToShow?.creatorName?.trim() || 'Not Available'}</strong></div>
                  <div><span>Created At</span><strong>{shiftTime(shiftToShow?.startTime)}</strong></div>
                  <div><span>Ended At</span><strong>{shiftToShow && !shiftToShow.inActive && !shiftToShow.endTime ? 'In progress' : shiftTime(shiftToShow?.endTime)}</strong></div>
                  <div><span>Bill Range</span><strong>{shiftToShow?.startBillNo || '—'} → {shiftToShow?.lastBillNo || '—'}</strong></div>
                  <div><span>Status</span><strong className={shiftToShow?.inActive ? 'status-closed' : 'status-active'}>{shiftToShow ? dashboardShiftStatus(shiftToShow) : 'Not Available'}</strong></div>
                  <div><span>Device ID</span><strong className="shift-device-id">{shiftToShow?.deviceId?.trim() || 'Not Available'}</strong></div>
                  {shiftToShow?.deviceId?.trim() && <DashboardDeviceQr key={shiftToShow.deviceId} deviceId={shiftToShow.deviceId} />}
                </article>
                <button type="button" className="help-card"><CircleHelp /><span><strong>Need help?</strong><small>View POS documentation</small></span></button>
              </aside>
              </div>
            </>
          )}
          </RouteLoadBoundary>
        </main>
      </div>
      {logoutConfirmationOpen && <LogoutConfirmation onCancel={() => setLogoutConfirmationOpen(false)} onConfirm={handleLogout} />}
    </div>
    </>
  );
}
