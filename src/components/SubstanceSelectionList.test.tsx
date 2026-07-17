import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    });
  });

  it('renders substances grouped by category', () => {
    render(<SubstanceSelectionList />);
    expect(screen.getByText('Stimulants')).toBeInTheDocument();
    expect(screen.getByText('Empathogens')).toBeInTheDocument();
    expect(screen.getByText('Caffeine')).toBeInTheDocument();
    expect(screen.getByText('MDMA')).toBeInTheDocument();
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
    });
    render(<SubstanceSelectionList />);
    fireEvent.click(screen.getByLabelText('MDMA'));
    expect(updateSettings).toHaveBeenCalledWith({ enabledSubstances: { mdma: true } });
  });

  it('filters substances by search query', () => {
    render(<SubstanceSelectionList />);
    fireEvent.change(screen.getByPlaceholderText('Search substances...'), { target: { value: 'caffeine' } });
    expect(screen.getByText('Caffeine')).toBeInTheDocument();
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
});