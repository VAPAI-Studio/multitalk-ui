import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Breadcrumb } from '../Breadcrumb';

describe('Breadcrumb', () => {
  it('renders root segment for empty path', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb currentPath="" onNavigate={onNavigate} />);

    expect(screen.getByText('🏠 Root')).toBeInTheDocument();
    expect(screen.getByText('Location:')).toBeInTheDocument();
  });

  it('parses simple path into segments', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb currentPath="models" onNavigate={onNavigate} />);

    expect(screen.getByText('🏠 Root')).toBeInTheDocument();
    expect(screen.getByText('models')).toBeInTheDocument();
    expect(screen.getByText('/')).toBeInTheDocument();
  });

  it('parses nested path into multiple segments', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb currentPath="models/checkpoints/flux" onNavigate={onNavigate} />);

    expect(screen.getByText('🏠 Root')).toBeInTheDocument();
    expect(screen.getByText('models')).toBeInTheDocument();
    expect(screen.getByText('checkpoints')).toBeInTheDocument();
    expect(screen.getByText('flux')).toBeInTheDocument();
  });

  it('highlights current segment', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb currentPath="models/checkpoints" onNavigate={onNavigate} />);

    const checkpointsButton = screen.getByText('checkpoints').closest('button');
    expect(checkpointsButton).toHaveClass('bg-blue-100', 'text-blue-700');
    expect(checkpointsButton).toBeDisabled();
  });

  it('calls onNavigate when clicking intermediate segment', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb currentPath="models/checkpoints/flux" onNavigate={onNavigate} />);

    const modelsButton = screen.getByText('models').closest('button');
    fireEvent.click(modelsButton!);

    expect(onNavigate).toHaveBeenCalledWith('models');
  });

  it('calls onNavigate with empty string when clicking root', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb currentPath="models/checkpoints" onNavigate={onNavigate} />);

    const rootButton = screen.getByText('🏠 Root').closest('button');
    fireEvent.click(rootButton!);

    expect(onNavigate).toHaveBeenCalledWith('');
  });

  it('does not call onNavigate when clicking current segment', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb currentPath="models" onNavigate={onNavigate} />);

    const currentButton = screen.getByText('models').closest('button');
    fireEvent.click(currentButton!);

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('renders separators between segments', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb currentPath="models/checkpoints/flux" onNavigate={onNavigate} />);

    const separators = screen.getAllByText('/');
    expect(separators).toHaveLength(3); // Between Root/models, models/checkpoints, checkpoints/flux
  });
});
