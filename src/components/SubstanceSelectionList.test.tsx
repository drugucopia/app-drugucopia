import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubstanceSelectionList } from '@/components/SubstanceSelectionList';
import { useToleranceNotificationStore } from '@/store/tolerance-notification-store';
import { getAllSubstances } from '@/lib/substances';

vi.mock('@/store/tolerance-notification-store');
vi.mock('@/lib/substances');

describe('SubstanceSelectionList', () => {
  const mockSubstances = [
    { id: 'caffeine', name: 'Caffeine', commonNames: ['Coffee'], categories: ['stimulants'] },
    { id: 'mdma', name: 'MDMA', commonNames: ['Molly'], categories: ['empathogens'] },
  ];

  beforeEach(() => {
    (getAllSubstances as vi.Mock).mockReturnValue(mockSubstances);
    (useToleranceNotificationStore as vi.Mock).mockReturnValue({
      settings: {
        enabled: true,
        notifyOnHigh: true,
        notifyOnLow: false,
        notifyOnBaseline: false,
        notificationCooldownMinutes: 1440,
        checkIntervalMinutes: 1440,
        enabledSubstances: { caffeine: true },
        substanceThresholds: { caffeine: { notifyOnHigh: false } },
      },
      updateSettings: vi.fn(),
      isLoaded: true,
    });
  });

  it('renders substances grouped by category', () => {
    render(<SubstanceSelectionList />);
    expect(screen.getByText('Stimulants')).toBeInTheDocument();
    expect(screen.getByText('Empathogens')).toBeInTheDocument();
    // Caffeine is enabled in the default mock, so it appears both as a
    // selected-substance chip AND as a row in the Stimulants group.
    expect(screen.getAllByText('Caffeine').length).toBeGreaterThan(0);
    expect(screen.getByText('MDMA')).toBeInTheDocument();
  });

  it('shows selected substances as removable chips above the search box', () => {
    // Caffeine is enabled in the default beforeEach mock — chip should render.
    render(<SubstanceSelectionList />);
    expect(screen.getByLabelText('Remove Caffeine')).toBeInTheDocument();
    expect(screen.getByText(/Selected \(1\)/)).toBeInTheDocument();
  });

  it('removes a substance from enabledSubstances when its chip X is clicked', () => {
    const updateSettings = vi.fn();
    (useToleranceNotificationStore as vi.Mock).mockReturnValue({
      settings: {
        enabled: true,
        notifyOnHigh: true,
        notifyOnLow: false,
        notifyOnBaseline: false,
        notificationCooldownMinutes: 1440,
        checkIntervalMinutes: 1440,
        enabledSubstances: { caffeine: true, mdma: true },
        substanceThresholds: { caffeine: { notifyOnHigh: false } },
      },
      updateSettings,
      isLoaded: true,
    });
    render(<SubstanceSelectionList />);
    fireEvent.click(screen.getByLabelText('Remove Caffeine'));
    // Should delete the caffeine key entirely (not just flip to false)
    expect(updateSettings).toHaveBeenCalledWith({
      enabledSubstances: { mdma: true },
      substanceThresholds: {},
    });
  });

  it('shows checkbox checked for enabled substances', () => {
    render(<SubstanceSelectionList />);
    expect(screen.getByLabelText('Caffeine')).toBeChecked();
    expect(screen.getByLabelText('MDMA')).not.toBeChecked();
  });

  it('calls updateSettings when toggling substance', () => {
    const updateSettings = vi.fn();
    (useToleranceNotificationStore as vi.Mock).mockReturnValue({
      settings: { enabledSubstances: {}, substanceThresholds: {}, notifyOnHigh: true, notifyOnLow: false, notifyOnBaseline: false },
      updateSettings,
      isLoaded: true,
    });
    render(<SubstanceSelectionList />);
    fireEvent.click(screen.getByLabelText('MDMA'));
    expect(updateSettings).toHaveBeenCalledWith({ enabledSubstances: { mdma: true } });
  });

  it('filters substances by search query', () => {
    render(<SubstanceSelectionList />);
    fireEvent.change(screen.getByPlaceholderText('Search substances...'), { target: { value: 'caffeine' } });
    // Caffeine is enabled (chip shown) and also matches the search query
    // (list row shown), so it appears in two places.
    expect(screen.getAllByText('Caffeine').length).toBeGreaterThan(0);
    expect(screen.queryByText('MDMA')).not.toBeInTheDocument();
  });

  it('shows override dropdowns when expanded', () => {
    render(<SubstanceSelectionList />);
    // Expand caffeine specifically by clicking its expand button
    const caffeineLabel = screen.getByLabelText('Caffeine');
    const caffeineRow = caffeineLabel.closest('.bg-base-100');
    const expandButton = caffeineRow?.querySelector('button') as HTMLElement;
    fireEvent.click(expandButton!);
    // Check the select value for caffeine's High override within the expanded row
    const openDetails = caffeineRow?.querySelector('details[open]');
    const select = openDetails?.querySelector('select') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('off'); // override set to false
  });

  it('shows loading spinner while store is hydrating', () => {
    (useToleranceNotificationStore as vi.Mock).mockReturnValue({
      settings: {
        enabled: true,
        notifyOnHigh: true,
        notifyOnLow: false,
        notifyOnBaseline: false,
        notificationCooldownMinutes: 1440,
        checkIntervalMinutes: 1440,
        enabledSubstances: {},
        substanceThresholds: {},
      },
      updateSettings: vi.fn(),
      isLoaded: false,
    });
    render(<SubstanceSelectionList />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('flex');
  });

  it('shows "Select all visible" button when search results exist', () => {
    render(<SubstanceSelectionList />);
    fireEvent.change(screen.getByPlaceholderText('Search substances...'), { target: { value: 'caffeine' } });
    expect(screen.getByRole('button', { name: /select all visible/i })).toBeInTheDocument();
  });

  it('enables all visible substances when "Select all visible" is clicked', () => {
    const updateSettings = vi.fn();
    (useToleranceNotificationStore as vi.Mock).mockReturnValue({
      settings: {
        enabled: true,
        notifyOnHigh: true,
        notifyOnLow: false,
        notifyOnBaseline: false,
        notificationCooldownMinutes: 1440,
        checkIntervalMinutes: 1440,
        enabledSubstances: {},
        substanceThresholds: {},
      },
      updateSettings,
      isLoaded: true,
    });
    render(<SubstanceSelectionList />);
    fireEvent.change(screen.getByPlaceholderText('Search substances...'), { target: { value: 'caffeine' } });
    fireEvent.click(screen.getByRole('button', { name: /select all visible/i }));
    expect(updateSettings).toHaveBeenCalledWith({
      enabledSubstances: { caffeine: true },
    });
  });

  it('includes custom substances from localStorage in grouping', () => {
    const customSubstances = [
      { id: 'caffeine', name: 'Caffeine', commonNames: ['Coffee'], categories: ['stimulants'] },
      { id: 'custom-1', name: 'Custom Substance', commonNames: [], categories: ['other'] },
    ];
    (getAllSubstances as vi.Mock).mockReturnValue(customSubstances);
    render(<SubstanceSelectionList />);
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getByText('Custom Substance')).toBeInTheDocument();
  });
});
