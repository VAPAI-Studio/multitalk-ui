import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileTreeNode } from '../FileTreeNode';
import { apiClient } from '../../lib/apiClient';

vi.mock('../../lib/apiClient');

describe('FileTreeNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a file item with metadata', () => {
    const fileItem = {
      type: 'file' as const,
      name: 'test.txt',
      path: 'test.txt',
      size: 1024,
      sizeHuman: '1.0 KB',
      lastModified: '2026-03-01T12:00:00Z',
      childCount: null
    };

    render(<FileTreeNode item={fileItem} depth={0} />);

    expect(screen.getByText('test.txt')).toBeInTheDocument();
    expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    expect(screen.getByText('📄')).toBeInTheDocument();
  });

  it('renders a folder item with closed icon', () => {
    const folderItem = {
      type: 'folder' as const,
      name: 'models',
      path: 'models',
      size: null,
      sizeHuman: null,
      lastModified: null,
      childCount: null
    };

    render(<FileTreeNode item={folderItem} depth={0} />);

    expect(screen.getByText('models')).toBeInTheDocument();
    expect(screen.getByText('📁')).toBeInTheDocument();
  });

  it('expands folder and loads children on click', async () => {
    const folderItem = {
      type: 'folder' as const,
      name: 'models',
      path: 'models',
      size: null,
      sizeHuman: null,
      lastModified: null,
      childCount: null
    };

    const mockChildren = {
      items: [
        {
          type: 'file' as const,
          name: 'child.txt',
          path: 'models/child.txt',
          size: 2048,
          sizeHuman: '2.0 KB',
          lastModified: '2026-03-01T12:00:00Z',
          childCount: null
        }
      ],
      totalItems: 1,
      hasMore: false,
      continuationToken: null
    };

    vi.mocked(apiClient.listFiles).mockResolvedValue(mockChildren);

    render(<FileTreeNode item={folderItem} depth={0} />);

    const folderElement = screen.getByText('models');
    fireEvent.click(folderElement);

    await waitFor(() => {
      expect(apiClient.listFiles).toHaveBeenCalledWith('models', 200);
    });

    await waitFor(() => {
      expect(screen.getByText('child.txt')).toBeInTheDocument();
      expect(screen.getByText('📂')).toBeInTheDocument(); // Open folder icon
    });
  });

  it('collapses folder on second click', async () => {
    const folderItem = {
      type: 'folder' as const,
      name: 'models',
      path: 'models',
      size: null,
      sizeHuman: null,
      lastModified: null,
      childCount: null
    };

    const mockChildren = {
      items: [
        {
          type: 'file' as const,
          name: 'child.txt',
          path: 'models/child.txt',
          size: 2048,
          sizeHuman: '2.0 KB',
          lastModified: null,
          childCount: null
        }
      ],
      totalItems: 1,
      hasMore: false,
      continuationToken: null
    };

    vi.mocked(apiClient.listFiles).mockResolvedValue(mockChildren);

    render(<FileTreeNode item={folderItem} depth={0} />);

    const folderElement = screen.getByText('models');

    // First click: expand
    fireEvent.click(folderElement);
    await waitFor(() => expect(screen.getByText('child.txt')).toBeInTheDocument());

    // Second click: collapse
    fireEvent.click(folderElement);
    await waitFor(() => expect(screen.queryByText('child.txt')).not.toBeInTheDocument());
  });

  it('displays error message on load failure', async () => {
    const folderItem = {
      type: 'folder' as const,
      name: 'models',
      path: 'models',
      size: null,
      sizeHuman: null,
      lastModified: null,
      childCount: null
    };

    vi.mocked(apiClient.listFiles).mockRejectedValue(new Error('Network error'));

    render(<FileTreeNode item={folderItem} depth={0} />);

    const folderElement = screen.getByText('models');
    fireEvent.click(folderElement);

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it('displays empty folder message when no children', async () => {
    const folderItem = {
      type: 'folder' as const,
      name: 'empty',
      path: 'empty',
      size: null,
      sizeHuman: null,
      lastModified: null,
      childCount: null
    };

    vi.mocked(apiClient.listFiles).mockResolvedValue({
      items: [],
      totalItems: 0,
      hasMore: false,
      continuationToken: null
    });

    render(<FileTreeNode item={folderItem} depth={0} />);

    const folderElement = screen.getByText('empty');
    fireEvent.click(folderElement);

    await waitFor(() => {
      expect(screen.getByText('Empty folder')).toBeInTheDocument();
    });
  });

  it('shows Load more button inside expanded folder when hasMore is true', async () => {
    const folderItem = {
      type: 'folder' as const,
      name: 'big-folder',
      path: 'big-folder',
      size: null,
      sizeHuman: null,
      lastModified: null,
      childCount: null
    };

    vi.mocked(apiClient.listFiles).mockResolvedValue({
      items: [
        { type: 'file' as const, name: 'child.bin', path: 'big-folder/child.bin', size: 100, sizeHuman: '100 B', lastModified: null, childCount: null }
      ],
      totalItems: 1,
      hasMore: true,
      continuationToken: 'tok2'
    });

    render(<FileTreeNode item={folderItem} depth={0} />);

    fireEvent.click(screen.getByText('big-folder'));

    await waitFor(() => {
      expect(screen.getByText('child.bin')).toBeInTheDocument();
      expect(screen.getByText('Load more')).toBeInTheDocument();
    });
  });
});
