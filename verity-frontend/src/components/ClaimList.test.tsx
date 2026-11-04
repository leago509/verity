import { render, screen } from '@testing-library/react';
import ClaimList from './ClaimList';

it('says evidence is unavailable instead of inventing a link (UC-06)', () => {
  render(
    <ClaimList
      transcript={[]}
      onEvidenceClick={() => undefined}
      claims={[{ result_id: 'c', statement_text: 'X happened', classification: 'UNSUPPORTED', ragas_score: 0.1, nli_label: 'NEUTRAL', evidence: [] }]}
    />,
  );
  expect(screen.getByText(/Evidence unavailable/)).toBeInTheDocument();
});
