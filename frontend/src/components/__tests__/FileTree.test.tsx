import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

  it('shows Load more button when hasMore is true', async () => {
    vi.mocked(apiClient.listFiles).mockResolvedValue({
      items: [
        { type: 'file' as const, name: 'file.bin', path: 'file.bin', size: 100, sizeHuman: '100 B', lastModified: null, childCount: null }
      ],
      totalItems: 1,
      hasMore: true,
      continuationToken: 'tok1'
    });

    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText('Load more')).toBeInTheDocument();
    });
  });

  it('does not show Load more button when hasMore is false', async () => {
    vi.mocked(apiClient.listFiles).mockResolvedValue({
      items: [
        { type: 'file' as const, name: 'file.bin', path: 'file.bin', size: 100, sizeHuman: '100 B', lastModified: null, childCount: null }
      ],
      totalItems: 1,
      hasMore: false,
      continuationToken: null
    });

    render(<FileTree />);

    await waitFor(() => {
      expect(screen.queryByText('Load more')).not.toBeInTheDocument();
    });
  });

  it('clicking Load more appends items and passes continuationToken to second call', async () => {
    vi.mocked(apiClient.listFiles)
      .mockResolvedValueOnce({
        items: [
          { type: 'file' as const, name: 'first.bin', path: 'first.bin', size: 100, sizeHuman: '100 B', lastModified: null, childCount: null }
        ],
        totalItems: 1,
        hasMore: true,
        continuationToken: 'tok1'
      })
      .mockResolvedValueOnce({
        items: [
          { type: 'file' as const, name: 'second.bin', path: 'second.bin', size: 200, sizeHuman: '200 B', lastModified: null, childCount: null }
        ],
        totalItems: 1,
        hasMore: false,
        continuationToken: null
      });

    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText('first.bin')).toBeInTheDocument();
      expect(screen.getByText('Load more')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Load more'));

    await waitFor(() => {
      expect(screen.getByText('first.bin')).toBeInTheDocument();
      expect(screen.getByText('second.bin')).toBeInTheDocument();
      expect(screen.queryByText('Load more')).not.toBeInTheDocument();
    });

    expect(apiClient.listFiles).toHaveBeenCalledTimes(2);
    expect(apiClient.listFiles).toHaveBeenNthCalledWith(2, '', 200, 'tok1');
  });

  it('refresh button triggers exactly one additional apiClient.listFiles call', async () => {
    vi.mocked(apiClient.listFiles).mockResolvedValue({
      items: [
        { type: 'file' as const, name: 'file.bin', path: 'file.bin', size: 100, sizeHuman: '100 B', lastModified: null, childCount: null }
      ],
      totalItems: 1,
      hasMore: false,
      continuationToken: null
    });

    render(<FileTree />);

    await waitFor(() => {
      expect(screen.getByText('file.bin')).toBeInTheDocument();
    });
    expect(apiClient.listFiles).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Refresh current directory'));

    await waitFor(() => {
      expect(apiClient.listFiles).toHaveBeenCalledTimes(2);
    });
  });
});
