import { render, screen } from '@testing-library/react';
import { ClaimBadge } from './ClaimBadge';
import { StatusBadge } from './StatusBadge';

it('shows the claim label', () => {
  render(<ClaimBadge classification="PARTIALLY_SUPPORTED" />);
  expect(screen.getByText('Partially supported')).toBeInTheDocument();
});

it('shows the status label', () => {
  render(<StatusBadge status="TRANSCRIBING" />);
  expect(screen.getByText('Transcribing')).toBeInTheDocument();
});
