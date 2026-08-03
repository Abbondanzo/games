import { Navigate, Route, Routes } from 'react-router-dom';
import { Home } from './shared/Home';
import { ScrabbleTracker } from './scrabble/ScrabbleTracker';
import { CricketTracker } from './cricket/CricketTracker';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/scrabble" element={<ScrabbleTracker />} />
      <Route path="/cricket" element={<CricketTracker />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
