import { vi } from 'vitest';
(globalThis as any).jest = vi;
import React from 'react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSearchParams: () => ({ get: jest.fn() }),
  usePathname: () => '/',
}));

jest.mock('zustand', () => ({
  create: (fn: any) => {
    let state: any = {};
    const listeners = new Set<() => void>();
    const store = {
      getState: () => state,
      setState: (partial: any) => {
        state = typeof partial === 'function' ? partial(state) : { ...state, ...partial };
        listeners.forEach((l) => l());
      },
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    state = fn(store.setState, store.getState, store);
    return store;
  },
}));

jest.mock('@/store/dose-store', () => ({
  useDoseStore: {
    getState: () => ({
      doses: [],
      addDose: jest.fn(),
      initialize: jest.fn(),
      deleteDose: jest.fn(),
      updateDose: jest.fn(),
      clearAllDoses: jest.fn(),
    }),
    subscribe: jest.fn(),
  },
}));

jest.mock('@/store/reminder-store', () => ({
  useReminderStore: {
    getState: () => ({
      schedules: [],
      activeReminders: [],
      autoStartEnabled: true,
      soundEnabled: true,
      startTimer: jest.fn(),
      initialize: jest.fn(),
    }),
    subscribe: jest.fn(),
  },
}));

jest.mock('@/store/ui-store', () => ({
  useUIStore: {
    getState: () => ({
      sidebarOpen: false,
      toggleSidebar: jest.fn(),
    }),
    subscribe: jest.fn(),
  },
}));

jest.mock('@/store/visualizer-store', () => ({
  useVisualizerStore: {
    getState: () => ({}),
    subscribe: jest.fn(),
  },
}));

jest.mock('@/store/timeline-notification-store', () => ({
  useTimelineNotificationStore: {
    getState: () => ({}),
    subscribe: jest.fn(),
  },
}));

jest.mock('@/hooks/use-toast', () => ({
  toast: jest.fn(),
  useToast: () => ({ toast: jest.fn(), toasts: [] }),
}));

jest.mock('@/hooks/use-mobile', () => ({
  useMobile: () => false,
}));

jest.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: any) => value,
}));

jest.mock('@/lib/tauri-bridge', () => ({
  isTauri: () => false,
  showNotification: jest.fn(),
  checkNotificationPermissionStatus: jest.fn().mockResolvedValue('granted'),
  shouldPlayWebSound: () => true,
}));

jest.mock('@/lib/notification-utils', () => ({
  showBrowserNotification: jest.fn(),
}));

jest.mock('@/lib/sound-utils', () => ({
  playReminderSound: jest.fn(),
}));

jest.mock('@/components/reminder-provider', () => ({
  ReminderProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

jest.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

jest.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => React.createElement('button', { 'data-testid': 'theme-toggle' }, 'Theme'),
}));

jest.mock('@/components/command-palette', () => ({
  CommandPalette: () => React.createElement('div', { 'data-testid': 'command-palette' }),
}));

jest.mock('@/components/layout/LayoutClient', () => ({
  LayoutClient: ({ children }: any) => React.createElement('div', { 'data-testid': 'layout' }, children),
}));

jest.mock('@/components/layout/AppSidebar', () => ({
  AppSidebar: () => React.createElement('aside', { 'data-testid': 'sidebar' }),
}));

jest.mock('@/components/layout/TopBar', () => ({
  TopBar: () => React.createElement('header', { 'data-testid': 'topbar' }),
}));

jest.mock('@/components/layout/SubstanceSearch', () => ({
  SubstanceSearch: () => React.createElement('div', { 'data-testid': 'substance-search' }),
}));

jest.mock('@/components/dose-logger-modal', () => ({
  DoseLoggerModal: () => React.createElement('div', { 'data-testid': 'dose-logger-modal' }),
}));

jest.mock('@/components/active-doses-timeline', () => ({
  ActiveDosesTimeline: () => React.createElement('div', { 'data-testid': 'active-doses-timeline' }),
}));

jest.mock('@/components/milkdrop-background', () => ({
  MilkdropBackground: () => React.createElement('div', { 'data-testid': 'milkdrop' }),
}));

jest.mock('@/components/visualizer-controls', () => ({
  VisualizerControls: () => React.createElement('div', { 'data-testid': 'visualizer-controls' }),
}));

jest.mock('@/components/dose-history', () => ({
  DoseHistory: () => React.createElement('div', { 'data-testid': 'dose-history' }),
}));

jest.mock('@/components/dose-stats', () => ({
  DoseStats: () => React.createElement('div', { 'data-testid': 'dose-stats' }),
}));

jest.mock('@/components/active-reminders', () => ({
  ActiveReminders: () => React.createElement('div', { 'data-testid': 'active-reminders' }),
}));

jest.mock('@/components/reminder-settings', () => ({
  ReminderSettings: () => React.createElement('div', { 'data-testid': 'reminder-settings' }),
}));

jest.mock('@/components/timeline-notification-settings', () => ({
  TimelineNotificationSettings: () => React.createElement('div', { 'data-testid': 'timeline-notification-settings' }),
}));

jest.mock('@/components/sync-conflicts', () => ({
  SyncConflicts: () => React.createElement('div', { 'data-testid': 'sync-conflicts' }),
}));

jest.mock('@/components/intensity-timeline-chart', () => ({
  IntensityTimelineChart: () => React.createElement('div', { 'data-testid': 'intensity-timeline-chart' }),
}));

jest.mock('@/components/redose-planner', () => ({
  RedosePlanner: () => React.createElement('div', { 'data-testid': 'redose-planner' }),
}));

jest.mock('@/components/edit-dose-modal', () => ({
  EditDoseModal: () => React.createElement('div', { 'data-testid': 'edit-dose-modal' }),
}));

jest.mock('@/components/estimated-duration-badge', () => ({
  EstimatedDurationBadge: () => React.createElement('span', { 'data-testid': 'estimated-duration-badge' }),
}));

jest.mock('@/components/duration-override-fields', () => ({
  DurationOverrideFields: () => React.createElement('div', { 'data-testid': 'duration-override-fields' }),
}));

jest.mock('@/components/interaction-substance-selector', () => ({
  InteractionSubstanceSelector: () => React.createElement('div', { 'data-testid': 'interaction-substance-selector' }),
}));

jest.mock('@/components/interaction-results', () => ({
  InteractionResults: () => React.createElement('div', { 'data-testid': 'interaction-results' }),
}));

jest.mock('@/components/interaction-pair-card', () => ({
  InteractionPairCard: () => React.createElement('div', { 'data-testid': 'interaction-pair-card' }),
}));

jest.mock('@/components/home/home-content', () => ({
  HomeContent: () => React.createElement('div', { 'data-testid': 'home-content' }),
}));

jest.mock('@/components/home/library/SubstanceGrid', () => ({
  SubstanceGrid: () => React.createElement('div', { 'data-testid': 'substance-grid' }),
}));

jest.mock('@/components/home/library/SubstanceCard', () => ({
  SubstanceCard: () => React.createElement('div', { 'data-testid': 'substance-card' }),
}));

jest.mock('@/components/home/library/LibraryHero', () => ({
  LibraryHero: () => React.createElement('div', { 'data-testid': 'library-hero' }),
}));

jest.mock('@/components/home/library/CategoryFilterBar', () => ({
  CategoryFilterBar: () => React.createElement('div', { 'data-testid': 'category-filter-bar' }),
}));

jest.mock('@/components/home/detail/SubstanceDetail', () => ({
  SubstanceDetail: () => React.createElement('div', { 'data-testid': 'substance-detail' }),
}));

jest.mock('@/components/home/detail/SubstanceSummary', () => ({
  SubstanceSummary: () => React.createElement('div', { 'data-testid': 'substance-summary' }),
}));

jest.mock('@/components/home/detail/SubstanceQuickFacts', () => ({
  SubstanceQuickFacts: () => React.createElement('div', { 'data-testid': 'substance-quick-facts' }),
}));

jest.mock('@/components/home/detail/SubstanceDetailTabs', () => ({
  SubstanceDetailTabs: () => React.createElement('div', { 'data-testid': 'substance-detail-tabs' }),
}));

jest.mock('@/components/home/detail/DosageDurationPanel', () => ({
  DosageDurationPanel: () => React.createElement('div', { 'data-testid': 'dosage-duration-panel' }),
}));

jest.mock('@/components/dose-timeline/mobile-phase-bar', () => ({
  MobilePhaseBar: () => React.createElement('div', { 'data-testid': 'mobile-phase-bar' }),
}));

jest.mock('@/components/dose-timeline/dose-marker', () => ({
  DoseMarker: () => React.createElement('div', { 'data-testid': 'dose-marker' }),
}));

jest.mock('@/components/milkdrop-background-wrapper', () => ({
  MilkdropBackgroundWrapper: () => React.createElement('div', { 'data-testid': 'milkdrop-wrapper' }),
}));

const mockComponent = (name: string) => {
  return ({ children, ...props }: any) =>
    React.createElement('div', { 'data-testid': name.toLowerCase(), ...props }, children);
};

jest.mock('@/components/ui/accordion', () => ({
  Accordion: mockComponent('Accordion'),
  AccordionItem: mockComponent('AccordionItem'),
  AccordionTrigger: mockComponent('AccordionTrigger'),
  AccordionContent: mockComponent('AccordionContent'),
}));

jest.mock('@/components/ui/alert', () => ({
  Alert: mockComponent('Alert'),
  AlertTitle: mockComponent('AlertTitle'),
  AlertDescription: mockComponent('AlertDescription'),
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: mockComponent('Badge'),
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) =>
    React.createElement('button', { onClick, 'data-testid': 'button', ...props }, children),
}));

jest.mock('@/components/ui/card', () => ({
  Card: mockComponent('Card'),
  CardHeader: mockComponent('CardHeader'),
  CardTitle: mockComponent('CardTitle'),
  CardDescription: mockComponent('CardDescription'),
  CardContent: mockComponent('CardContent'),
  CardFooter: mockComponent('CardFooter'),
}));

jest.mock('@/components/ui/combobox', () => ({
  Combobox: mockComponent('Combobox'),
  ComboboxTrigger: mockComponent('ComboboxTrigger'),
  ComboboxContent: mockComponent('ComboboxContent'),
  ComboboxItem: mockComponent('ComboboxItem'),
  ComboboxGroup: mockComponent('ComboboxGroup'),
  ComboboxLabel: mockComponent('ComboboxLabel'),
  ComboboxSeparator: mockComponent('ComboboxSeparator'),
}));

jest.mock('@/components/ui/dialog', () => ({
  Dialog: mockComponent('Dialog'),
  DialogTrigger: mockComponent('DialogTrigger'),
  DialogContent: mockComponent('DialogContent'),
  DialogHeader: mockComponent('DialogHeader'),
  DialogTitle: mockComponent('DialogTitle'),
  DialogDescription: mockComponent('DialogDescription'),
  DialogFooter: mockComponent('DialogFooter'),
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: mockComponent('DropdownMenu'),
  DropdownMenuTrigger: mockComponent('DropdownMenuTrigger'),
  DropdownMenuContent: mockComponent('DropdownMenuContent'),
  DropdownMenuItem: mockComponent('DropdownMenuItem'),
  DropdownMenuSeparator: mockComponent('DropdownMenuSeparator'),
  DropdownMenuLabel: mockComponent('DropdownMenuLabel'),
  DropdownMenuGroup: mockComponent('DropdownMenuGroup'),
}));

jest.mock('@/components/ui/fieldset', () => ({
  Fieldset: mockComponent('Fieldset'),
  Legend: mockComponent('Legend'),
}));

jest.mock('@/components/ui/field', () => ({
  Field: mockComponent('Field'),
  FieldLabel: mockComponent('FieldLabel'),
  FieldDescription: mockComponent('FieldDescription'),
  FieldError: mockComponent('FieldError'),
}));

jest.mock('@/components/ui/input', () => ({
  Input: ({ ...props }: any) => React.createElement('input', { 'data-testid': 'input', ...props }),
}));

jest.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => React.createElement('label', { 'data-testid': 'label', ...props }, children),
}));

jest.mock('@/components/ui/select', () => ({
  Select: ({ children, ...props }: any) => React.createElement('select', { 'data-testid': 'select', ...props }, children),
  SelectTrigger: mockComponent('SelectTrigger'),
  SelectValue: mockComponent('SelectValue'),
  SelectContent: mockComponent('SelectContent'),
  SelectItem: mockComponent('SelectItem'),
  SelectGroup: mockComponent('SelectGroup'),
  SelectLabel: mockComponent('SelectLabel'),
  SelectSeparator: mockComponent('SelectSeparator'),
}));

jest.mock('@/components/ui/separator', () => ({
  Separator: ({ ...props }: any) => React.createElement('hr', { 'data-testid': 'separator', ...props }),
}));

jest.mock('@/components/ui/tabs', () => ({
  Tabs: mockComponent('Tabs'),
  TabsList: mockComponent('TabsList'),
  TabsTrigger: mockComponent('TabsTrigger'),
  TabsContent: mockComponent('TabsContent'),
}));

jest.mock('@/components/ui/textarea', () => ({
  Textarea: ({ ...props }: any) => React.createElement('textarea', { 'data-testid': 'textarea', ...props }),
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: mockComponent('Tooltip'),
  TooltipTrigger: mockComponent('TooltipTrigger'),
  TooltipContent: mockComponent('TooltipContent'),
  TooltipProvider: mockComponent('TooltipProvider'),
}));

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: mockComponent('ScrollArea'),
}));

jest.mock('lucide-react', () => {
  const icons = [
    'Activity', 'AlertTriangle', 'ArrowLeftRight', 'Beaker', 'Bell', 'BookOpen', 'Brain',
    'Calculator', 'Calendar', 'CalendarDays', 'Check', 'CheckSquare', 'ChevronDown', 'ChevronUp',
    'Clock', 'Copy', 'Droplets', 'ExternalLink', 'Flame', 'FlaskConical', 'GlassWater',
    'Heart', 'Info', 'Leaf', 'Minus', 'Orbit', 'Phone', 'Pill', 'Plus', 'RotateCcw',
    'Scale', 'Search', 'Shield', 'Shuffle', 'Skull', 'SlidersHorizontal', 'Syringe',
    'Target', 'TestTubes', 'Timer', 'Trees', 'Trophy', 'Users', 'Waves', 'X', 'Zap',
    'Sun', 'BarChart3', 'PieChart', 'BarChart', 'PieChart as PieIcon', 'BarChart2', 'PieChart as PieIcon2',
    'HeartPulse', 'BrainCircuit', 'Capsule', 'FlaskRound', 'Microscope', 'Pill', 'Syringe'
  ];
  const mock: Record<string, any> = {};
  for (const icon of icons) {
    const name = icon.split(' as ')[0];
    mock[name] = ({ ...props }: any) =>
      React.createElement('span', { 'data-testid': `icon-${name.toLowerCase()}`, ...props });
  }
  return mock;
});

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => React.createElement('div', props, children),
    span: ({ children, ...props }: any) => React.createElement('span', props, children),
    button: ({ children, ...props }: any) => React.createElement('button', props, children),
    section: ({ children, ...props }: any) => React.createElement('section', props, children),
    p: ({ children, ...props }: any) => React.createElement('p', props, children),
    h1: ({ children, ...props }: any) => React.createElement('h1', props, children),
    h2: ({ children, ...props }: any) => React.createElement('h2', props, children),
    h3: ({ children, ...props }: any) => React.createElement('h3', props, children),
  },
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

jest.mock('recharts', () => ({
  BarChart: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'bar-chart', ...props }, children),
  Bar: ({ ...props }: any) => React.createElement('div', { 'data-testid': 'bar', ...props }),
  LineChart: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'line-chart', ...props }, children),
  Line: ({ ...props }: any) => React.createElement('div', { 'data-testid': 'line', ...props }),
  PieChart: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'pie-chart', ...props }, children),
  Pie: ({ ...props }: any) => React.createElement('div', { 'data-testid': 'pie', ...props }),
  Cell: ({ ...props }: any) => React.createElement('div', { 'data-testid': 'cell', ...props }),
  XAxis: ({ ...props }: any) => React.createElement('div', { 'data-testid': 'x-axis', ...props }),
  YAxis: ({ ...props }: any) => React.createElement('div', { 'data-testid': 'y-axis', ...props }),
  CartesianGrid: ({ ...props }: any) => React.createElement('div', { 'data-testid': 'cartesian-grid', ...props }),
  Tooltip: ({ ...props }: any) => React.createElement('div', { 'data-testid': 'tooltip', ...props }),
  ResponsiveContainer: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'responsive-container', ...props }, children),
}));

jest.mock('@radix-ui/react-tabs', () => ({
  Tabs: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'radix-tabs', ...props }, children),
  TabsList: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'radix-tabs-list', ...props }, children),
  TabsTrigger: ({ children, ...props }: any) => React.createElement('button', { 'data-testid': 'radix-tabs-trigger', ...props }, children),
  TabsContent: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'radix-tabs-content', ...props }, children),
}));

jest.mock('embla-carousel-react', () => ({
  useEmblaCarousel: () => [{} as any, { scrollNext: jest.fn(), scrollPrev: jest.fn() }],
}));

jest.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'panel-group', ...props }, children),
  Panel: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'panel', ...props }, children),
  PanelResizeHandle: ({ ...props }: any) => React.createElement('div', { 'data-testid': 'panel-resize-handle', ...props }),
}));

jest.mock('vaul', () => ({
  Drawer: ({ children, open, onOpenChange, ...props }: any) =>
    open ? React.createElement('div', { 'data-testid': 'drawer', ...props }, children) : null,
  DrawerTrigger: ({ children, ...props }: any) => React.createElement('button', { 'data-testid': 'drawer-trigger', ...props }, children),
  DrawerContent: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'drawer-content', ...props }, children),
  DrawerHeader: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'drawer-header', ...props }, children),
  DrawerTitle: ({ children, ...props }: any) => React.createElement('h2', { 'data-testid': 'drawer-title', ...props }, children),
  DrawerDescription: ({ children, ...props }: any) => React.createElement('p', { 'data-testid': 'drawer-description', ...props }, children),
  DrawerClose: ({ children, ...props }: any) => React.createElement('button', { 'data-testid': 'drawer-close', ...props }, children),
}));

jest.mock('input-otp', () => ({
  OTPInput: ({ children, ...props }: any) => React.createElement('div', { 'data-testid': 'otp-input', ...props }, children),
  OTPInputContext: React.createContext(null),
}));

jest.mock('react-day-picker', () => ({
  DayPicker: ({ ...props }: any) => React.createElement('div', { 'data-testid': 'day-picker', ...props }),
  WeekNumber: ({ ...props }: any) => React.createElement('span', { 'data-testid': 'week-number', ...props }),
}));

jest.mock('react-hook-form', () => ({
  useForm: () => ({
    register: jest.fn(),
    handleSubmit: (fn: any) => fn,
    watch: jest.fn(),
    setValue: jest.fn(),
    getValues: jest.fn(),
    reset: jest.fn(),
    formState: { errors: {}, isSubmitting: false },
  }),
  Controller: ({ render, ...props }: any) => render({ field: { onChange: jest.fn(), onBlur: jest.fn(), value: '' }, fieldState: {} }),
  FormProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

jest.mock('@hookform/resolvers/zod', () => ({
  zodResolver: jest.fn(),
}));

jest.mock('zod', () => ({
  z: {
    string: () => ({ min: jest.fn().mockReturnThis(), max: jest.fn().mockReturnThis(), email: jest.fn().mockReturnThis() }),
    number: () => ({ min: jest.fn().mockReturnThis(), max: jest.fn().mockReturnThis() }),
    object: (shape: any) => ({ parse: (data: any) => data, safeParse: (data: any) => ({ success: true, data }) }),
    array: (item: any) => ({ min: jest.fn().mockReturnThis() }),
    enum: (values: any[]) => ({}),
    optional: (schema: any) => schema,
    nullable: (schema: any) => schema,
    coerce: { number: () => ({}) },
    union: (schemas: any[]) => ({}),
    literal: (value: any) => ({}),
    any: () => ({}),
    record: (key: any, value: any) => ({}),
    tuple: (items: any[]) => ({}),
  },
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    doseLog: { findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
    reminderSchedule: { findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
    $disconnect: jest.fn(),
  })),
}));

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
  NextAuth: jest.fn(),
}));

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signIn: jest.fn(),
  signOut: jest.fn(),
}));

Object.defineProperty(global, 'IntersectionObserver', {
  writable: true,
  value: jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  })),
});

Object.defineProperty(global, 'ResizeObserver', {
  writable: true,
  value: jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  })),
});

Object.defineProperty(global, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

Object.defineProperty(global, 'crypto', {
  writable: true,
  value: {
    ...global.crypto,
    randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
  },
});

const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  if (
    args[0]?.includes?.('Warning: ReactDOM.render is no longer supported') ||
    args[0]?.includes?.('act(...)') ||
    args[0]?.includes?.('useLayoutEffect does nothing on the server')
  ) {
    return;
  }
  originalConsoleError.apply(console, args);
};
