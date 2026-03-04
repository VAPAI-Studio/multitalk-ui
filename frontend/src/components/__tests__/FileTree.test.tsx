import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileTree } from '../FileTree';
import { apiClient } from '../../lib/apiClient';

vi.mock('../../lib/apiClient');

describe('FileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads root directory on mount', async () => {
    const mockRootItems = {
      items: [
        {
          type: 'folder' as const,
          name: 'models',
          path: 'models',
          size: null,
          sizeHuman: null,
          lastModified: null,
          childCount: null
        },
        {
          type: 'file' as const,
          name: 'config.json',
          path: 'config.json',
          size: 2048,
          sizeHuman: '2.0 KB',
          lastModified: '2026-03-01T12:00:00Z',
          childCount: null
        }
      ],
      totalItems: 2,
      hasMore: false,
      continuationToken: null
    };

    vi.mocked(apiClient.listFiles).mockResolvedValue(mockRootItems);

    render(<FileTree />);

    await waitFor(() => {
      expect(apiClient.listFiles).toHaveBeenCalledWith('', 200);
    });

    await waitFor(() => {
      expect(screen.getByText('models')).toBeInTheDocument();
      expect(screen.getByText('config.json')).toBeInTheDocument();
    });
  });

  it('displays loading state initially', () => {
    vi.mocked(apiClient.listFiles).mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<FileTree />);

    expect(screen.getByText('Loading network volume...')).toBeInTheDocument();
  });

  it('displays error state on load failure', async () => {
    vi.mocked(apiClient.listFiles).mockRejectedValue(new Error('S3 connection failed'));

    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText(/S3 connection failed/)).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('displays empty state when no items', async () => {
    vi.mocked(apiClient.listFiles).mockResolvedValue({
      items: [],
      totalItems: 0,
      hasMore: false,
      continuationToken: null
    });

    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText('Network volume is empty')).toBeInTheDocument();
    });
  });
});
